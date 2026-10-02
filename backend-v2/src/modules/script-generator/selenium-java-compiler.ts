/**
 * Deterministic Selenium WebDriver (Java) + JUnit 5 Page Object Model
 * compiler — the Selenium counterpart to playwright-compiler.ts, same
 * input shape, same "no AI in this path" guarantee. Chrome runs headed by
 * default, matching the Playwright runner's own config, so the user can
 * watch the execution live.
 */

interface CompilerObject {
  objectName: string;
  screenName: string | null;
  technicalPath: string;
  locatorStrategy?: string;
  objectType: string;
}

interface CompilerTestDataItem {
  key: string;
  value: string;
}

export interface CompilerStep {
  id: string;
  stepOrder: number;
  stepType: string;
  inlineValue: string | null;
  config: unknown;
  object: CompilerObject | null;
  testDataItem: CompilerTestDataItem | null;
}

export interface CompiledFile {
  fileName: string;
  code: string;
  role: 'SPEC' | 'PAGE_OBJECT' | 'FIXTURE' | 'CONFIG';
}

export interface CompileResult {
  files: CompiledFile[];
  command: string;
}

function toPascalCase(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
}

function toCamelCase(input: string): string {
  const pascal = toPascalCase(input);
  return pascal ? pascal[0].toLowerCase() + pascal.slice(1) : 'value';
}

function javaString(value: string): string {
  return JSON.stringify(value);
}

// Line comments (`//`) end at the first newline — any embedded \r or \n in
// user-supplied text (object names, etc.) would otherwise break out of the
// comment and inject raw, unindented lines into the generated Java source.
function sanitizeComment(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

const ACTION_VERB: Record<string, string> = {
  CLICK: 'click',
  ENTER_TEXT: 'enter',
  SELECT_DROPDOWN: 'select',
  VERIFY_TEXT: 'verifyTextOf',
  VERIFY_ELEMENT_VISIBLE: 'verifyVisible',
  UPLOAD_FILE: 'upload',
  HOVER: 'hoverOver',
  SCROLL: 'scrollTo',
  DOWNLOAD_FILE: 'download',
};

function methodNameFor(stepType: string, objectName: string): string {
  const verb = ACTION_VERB[stepType] ?? toCamelCase(stepType);
  return `${verb}${toPascalCase(objectName)}`;
}

function screenClassName(screenName: string | null | undefined): string {
  const base = toPascalCase(screenName || 'App');
  return base.endsWith('Page') ? base : `${base}Page`;
}

function configValue(config: unknown, key: string): unknown {
  if (config && typeof config === 'object') {
    return (config as Record<string, unknown>)[key];
  }
  return undefined;
}

// Every locator strategy this app records — except the true XPATH fallback —
// stores technicalPath as CSS-selector syntax already (see dom-walker.ts:
// #id, [data-testid="..."], [name="..."] are all CSS attribute selectors).
function byExpressionFor(obj: CompilerObject): string {
  const path = javaString(obj.technicalPath);
  return obj.locatorStrategy === 'XPATH' ? `By.xpath(${path})` : `By.cssSelector(${path})`;
}

export function compileFlowToSeleniumJava(params: {
  flowName: string;
  applicationEntryUrl: string | null;
  steps: CompilerStep[];
  // See playwright-compiler.ts's identical parameter — a cheap, non-
  // destructive pre-flight. Every bound object still gets located and
  // checked visible in 'validate' mode, but nothing is actually clicked,
  // typed, selected, or submitted, except a nav/tab object's own CLICK.
  mode?: 'execute' | 'validate';
}): CompileResult {
  const { flowName, applicationEntryUrl, steps, mode = 'execute' } = params;
  const suffix = mode === 'validate' ? 'Validate' : '';
  const flowPascalName = (toPascalCase(flowName) || 'GeneratedFlow') + suffix;
  const testClassName = `${flowPascalName}Test`;
  const dataClassName = `${flowPascalName}Data`;

  const screenGroups = new Map<string, CompilerStep[]>();
  for (const step of steps) {
    if (!step.object) continue;
    const screen = step.object.screenName || 'App';
    if (!screenGroups.has(screen)) screenGroups.set(screen, []);
    screenGroups.get(screen)!.push(step);
  }

  const pageObjectFiles: CompiledFile[] = [];
  const pageObjectFields: string[] = [];
  const pageObjectInstantiations: string[] = [];
  const stepMethodInfo = new Map<string, { instanceVar: string; methodName: string }>();

  for (const [screenName, screenSteps] of screenGroups) {
    const className = screenClassName(screenName);
    const instanceVar = toCamelCase(className);
    const methods: string[] = [];
    const seenMethods = new Set<string>();

    for (const step of screenSteps) {
      const obj = step.object!;
      const mName = methodNameFor(step.stepType, obj.objectName);
      stepMethodInfo.set(step.id, { instanceVar, methodName: mName });
      if (seenMethods.has(mName)) continue;
      seenMethods.add(mName);

      const by = byExpressionFor(obj);
      const isNavClick = step.stepType === 'CLICK' && /tab|nav/i.test(obj.objectType);

      if (mode === 'validate' && !isNavClick) {
        methods.push(
          `    public void ${mName}() {\n        new WebDriverWait(driver, Duration.ofSeconds(WAIT_SECONDS)).until(ExpectedConditions.visibilityOfElementLocated(${by}));\n    }`,
        );
        continue;
      }

      // Every lookup below goes through an explicit WebDriverWait for the
      // condition that action actually needs (clickable for a click,
      // visible for reading/asserting text, present for a hidden file input
      // or a pre-scroll target) instead of a bare findElement(). Selenium's
      // findElement doesn't auto-wait for actionability the way Playwright's
      // locator actions do — until now the only wait in a generated script
      // was one global 10s *implicit* wait set once in @BeforeEach, which
      // doesn't wait for an element to become clickable/visible/stable, only
      // for it to exist in the DOM at all. This is the same class of gap the
      // SAPUI5 dropdown had in the Playwright compiler before that was fixed
      // this session, generalized to every Selenium action.
      switch (step.stepType) {
        case 'CLICK':
          methods.push(
            `    public void ${mName}() {\n        new WebDriverWait(driver, Duration.ofSeconds(WAIT_SECONDS)).until(ExpectedConditions.elementToBeClickable(${by})).click();\n    }`,
          );
          break;
        case 'ENTER_TEXT':
          methods.push(
            `    public void ${mName}(String value) {\n        WebElement el = new WebDriverWait(driver, Duration.ofSeconds(WAIT_SECONDS)).until(ExpectedConditions.visibilityOfElementLocated(${by}));\n        el.clear();\n        el.sendKeys(value);\n    }`,
          );
          break;
        case 'SELECT_DROPDOWN':
          methods.push(
            `    public void ${mName}(String value) {\n        WebElement el = new WebDriverWait(driver, Duration.ofSeconds(WAIT_SECONDS)).until(ExpectedConditions.elementToBeClickable(${by}));\n        new Select(el).selectByVisibleText(value);\n    }`,
          );
          break;
        case 'VERIFY_TEXT':
          methods.push(
            `    public void ${mName}(String expected) {\n        WebElement el = new WebDriverWait(driver, Duration.ofSeconds(WAIT_SECONDS)).until(ExpectedConditions.visibilityOfElementLocated(${by}));\n        String actual = el.getText();\n        Assertions.assertTrue(actual.contains(expected), "Expected text containing '" + expected + "' but found '" + actual + "'");\n    }`,
          );
          break;
        case 'VERIFY_ELEMENT_VISIBLE':
          methods.push(
            `    public void ${mName}() {\n        new WebDriverWait(driver, Duration.ofSeconds(WAIT_SECONDS)).until(ExpectedConditions.visibilityOfElementLocated(${by}));\n    }`,
          );
          break;
        case 'UPLOAD_FILE':
          // File inputs are commonly hidden/zero-size by design (styled via
          // a visible label) — waiting for visibility would fail on exactly
          // the normal case, so this waits for presence only.
          methods.push(
            `    public void ${mName}(String filePath) {\n        WebElement el = new WebDriverWait(driver, Duration.ofSeconds(WAIT_SECONDS)).until(ExpectedConditions.presenceOfElementLocated(${by}));\n        el.sendKeys(filePath);\n    }`,
          );
          break;
        case 'HOVER':
          methods.push(
            `    public void ${mName}() {\n        WebElement el = new WebDriverWait(driver, Duration.ofSeconds(WAIT_SECONDS)).until(ExpectedConditions.visibilityOfElementLocated(${by}));\n        new Actions(driver).moveToElement(el).perform();\n    }`,
          );
          break;
        case 'SCROLL':
          methods.push(
            `    public void ${mName}() {\n        WebElement el = new WebDriverWait(driver, Duration.ofSeconds(WAIT_SECONDS)).until(ExpectedConditions.presenceOfElementLocated(${by}));\n        ((JavascriptExecutor) driver).executeScript("arguments[0].scrollIntoView(true);", el);\n    }`,
          );
          break;
        default:
          break;
      }
    }

    const code = [
      `package generated;`,
      ``,
      `import java.time.Duration;`,
      `import org.openqa.selenium.*;`,
      `import org.openqa.selenium.support.ui.Select;`,
      `import org.openqa.selenium.support.ui.WebDriverWait;`,
      `import org.openqa.selenium.support.ui.ExpectedConditions;`,
      `import org.openqa.selenium.interactions.Actions;`,
      `import org.junit.jupiter.api.Assertions;`,
      ``,
      `public class ${className} {`,
      `    private static final int WAIT_SECONDS = 15;`,
      `    private final WebDriver driver;`,
      ``,
      `    public ${className}(WebDriver driver) {`,
      `        this.driver = driver;`,
      `    }`,
      ``,
      methods.join('\n\n'),
      `}`,
      ``,
    ].join('\n');

    pageObjectFiles.push({ fileName: `${className}.java`, code, role: 'PAGE_OBJECT' });
    // Declared without an initializer: field initializers run before
    // @BeforeEach, which is where `driver` actually gets assigned — a page
    // object built here would permanently hold a null WebDriver.
    pageObjectFields.push(`    private ${className} ${instanceVar};`);
    pageObjectInstantiations.push(`        ${instanceVar} = new ${className}(driver);`);
  }

  // Test data resolved at RUN time (not generation time), same reasoning as
  // the Playwright compiler's fixture — placeholders like {{timestamp}} must
  // stay fresh on every execution, not freeze at the moment code was generated.
  const dataEntries = new Map<string, string>();
  function dataVarFor(step: CompilerStep): string | null {
    if (step.testDataItem) {
      const varName = toCamelCase(step.testDataItem.key);
      dataEntries.set(varName, step.testDataItem.value);
      return varName;
    }
    if (step.inlineValue) {
      const varName = `${toCamelCase(step.object?.objectName ?? step.stepType)}Value`;
      dataEntries.set(varName, step.inlineValue);
      return varName;
    }
    return null;
  }

  // JUnit only reports pass/fail for the whole @Test method — there's no
  // built-in per-step reporting the way Playwright's test.step() gives us.
  // So each step gets its own try/catch that appends a PASS/FAIL line to a
  // shared log, written to disk in a finally block. The runner (see
  // execution/selenium-runner.ts) reads that file instead of inferring
  // anything from a stack trace, matching this app's "no fragile inference"
  // policy for reporting.
  const stepBlocks: string[] = [];
  for (const step of steps) {
    const actionLines: string[] = [];

    switch (step.stepType) {
      case 'OPEN_URL': {
        const url = configValue(step.config, 'url') || step.inlineValue || applicationEntryUrl || 'about:blank';
        actionLines.push(`            driver.get(${javaString(String(url))});`);
        break;
      }
      case 'WAIT': {
        const ms = Number(configValue(step.config, 'durationMs') ?? 1000);
        actionLines.push(`            Thread.sleep(${ms});`);
        break;
      }
      case 'ACCEPT_ALERT': {
        actionLines.push(`            driver.switchTo().alert().accept();`);
        break;
      }
      case 'SWITCH_TAB': {
        actionLines.push(`            // Switches to the most recently opened browser tab/window.`);
        actionLines.push(`            String current = driver.getWindowHandle();`);
        actionLines.push(`            for (String handle : driver.getWindowHandles()) {`);
        actionLines.push(`                if (!handle.equals(current)) driver.switchTo().window(handle);`);
        actionLines.push(`            }`);
        break;
      }
      case 'API_CALL':
      case 'DB_VALIDATION':
      case 'SAP_VALIDATION': {
        actionLines.push(`            // ${step.stepType} is reserved for a future phase — not implemented yet.`);
        break;
      }
      default: {
        const info = stepMethodInfo.get(step.id);
        if (!info) {
          actionLines.push(`            // No object assigned for this step — skipped during generation.`);
          break;
        }
        const isNavClick = mode === 'validate' && step.stepType === 'CLICK' && step.object != null && /tab|nav/i.test(step.object.objectType);
        const takesArgument =
          (mode === 'execute' || isNavClick) &&
          (step.stepType === 'ENTER_TEXT' || step.stepType === 'SELECT_DROPDOWN' || step.stepType === 'VERIFY_TEXT' || step.stepType === 'UPLOAD_FILE');
        if (takesArgument) {
          const dataVar = dataVarFor(step);
          const arg = dataVar
            ? `${dataClassName}.resolvePlaceholders(${dataClassName}.${dataVar})`
            : javaString(step.inlineValue ?? '');
          actionLines.push(`            ${info.instanceVar}.${info.methodName}(${arg});`);
        } else {
          actionLines.push(`            ${info.instanceVar}.${info.methodName}();`);
        }
      }
    }

    stepBlocks.push(
      [
        `        // Step ${step.stepOrder}: ${step.stepType}${step.object ? ` (${sanitizeComment(step.object.objectName)})` : ''}`,
        `        try {`,
        ...actionLines,
        `            takeScreenshot(${step.stepOrder});`,
        `            stepLog.add(${step.stepOrder} + "|PASS|");`,
        `        } catch (Throwable t) {`,
        `            takeScreenshot(${step.stepOrder}); // capture the page as it looked at the moment of failure`,
        `            stepLog.add(${step.stepOrder} + "|FAIL|" + String.valueOf(t.getMessage()).replaceAll("[\\r\\n|]+", " "));`,
        `            throw t;`,
        `        }`,
      ].join('\n'),
    );
  }

  const dataCode = [
    `package generated;`,
    ``,
    `import java.time.LocalDate;`,
    `import java.time.format.DateTimeFormatter;`,
    `import java.util.regex.Matcher;`,
    `import java.util.regex.Pattern;`,
    ``,
    `// Generated data fixture. Values may contain placeholder tokens resolved at run time.`,
    `public final class ${dataClassName} {`,
    `    private ${dataClassName}() {}`,
    ``,
    ...Array.from(dataEntries.entries()).map(([varName, rawValue]) => `    public static final String ${varName} = ${javaString(rawValue)};`),
    ``,
    `    private static final Pattern TOKEN = Pattern.compile("\\\\{\\\\{\\\\s*([a-zA-Z]+)(?::(\\\\d+))?\\\\s*\\\\}\\\\}");`,
    ``,
    `    public static String resolvePlaceholders(String value) {`,
    `        Matcher m = TOKEN.matcher(value);`,
    `        StringBuilder out = new StringBuilder();`,
    `        while (m.find()) {`,
    `            String token = m.group(1).toLowerCase();`,
    `            String replacement;`,
    `            switch (token) {`,
    `                case "timestamp":`,
    `                    replacement = String.valueOf(System.currentTimeMillis());`,
    `                    break;`,
    `                case "randomemail":`,
    `                    replacement = "user" + (100000 + (int) (Math.random() * 900000)) + "@example.com";`,
    `                    break;`,
    `                case "randomuser":`,
    `                    replacement = "user" + (100000 + (int) (Math.random() * 900000));`,
    `                    break;`,
    `                case "today":`,
    `                    replacement = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE);`,
    `                    break;`,
    `                case "futuredate": {`,
    `                    int days = m.group(2) != null ? Integer.parseInt(m.group(2)) : 7;`,
    `                    replacement = LocalDate.now().plusDays(days).format(DateTimeFormatter.ISO_LOCAL_DATE);`,
    `                    break;`,
    `                }`,
    `                default:`,
    `                    replacement = m.group(0);`,
    `            }`,
    `            m.appendReplacement(out, Matcher.quoteReplacement(replacement));`,
    `        }`,
    `        m.appendTail(out);`,
    `        return out.toString();`,
    `    }`,
    `}`,
    ``,
  ].join('\n');

  const testCode = [
    `package generated;`,
    ``,
    `import java.io.File;`,
    `import java.nio.file.Files;`,
    `import java.nio.file.Paths;`,
    `import java.time.Duration;`,
    `import org.openqa.selenium.OutputType;`,
    `import org.openqa.selenium.TakesScreenshot;`,
    `import org.openqa.selenium.WebDriver;`,
    `import org.openqa.selenium.JavascriptExecutor;`,
    `import org.openqa.selenium.chrome.ChromeDriver;`,
    `import org.openqa.selenium.chrome.ChromeOptions;`,
    `import org.junit.jupiter.api.*;`,
    ``,
    `public class ${testClassName} {`,
    `    private WebDriver driver;`,
    ...pageObjectFields,
    ``,
    `    @BeforeEach`,
    `    void setUp() {`,
    `        ChromeOptions options = new ChromeOptions();`,
    `        // Headed on purpose: the user watches each execution run live, matching the Playwright runner's config.`,
    `        // Internal/enterprise apps (SAP Fiori launchpads especially) are often served`,
    `        // on a self-signed or internally-issued certificate — without this, Chrome`,
    `        // blocks the very first navigation at the TLS handshake.`,
    `        options.setAcceptInsecureCerts(true);`,
    `        driver = new ChromeDriver(options);`,
    `        // Unlike Playwright, Selenium's findElement doesn't auto-wait — an`,
    `        // implicit wait is the closest equivalent so a slow-rendering SPA`,
    `        // doesn't fail the very next line before its JS has run.`,
    `        driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10));`,
    ...pageObjectInstantiations,
    `    }`,
    ``,
    `    // One screenshot per step, always (not just on failure), for review in`,
    `    // the Executions UI after the run finishes. Mirrors playwright-compiler.ts's approach.`,
    `    private void takeScreenshot(int stepOrder) {`,
    `        try {`,
    `            Files.createDirectories(Paths.get("test-results"));`,
    `            File src = ((TakesScreenshot) driver).getScreenshotAs(OutputType.FILE);`,
    `            Files.copy(src.toPath(), Paths.get("test-results", "step-" + stepOrder + ".png"), java.nio.file.StandardCopyOption.REPLACE_EXISTING);`,
    `        } catch (Exception ignored) {`,
    `        }`,
    `    }`,
    ``,
    `    @Test`,
    `    void ${toCamelCase(flowName)}() throws Throwable {`,
    `        java.util.List<String> stepLog = new java.util.ArrayList<>();`,
    `        try {`,
    ...stepBlocks,
    `        } finally {`,
    `            try {`,
    `                Files.createDirectories(Paths.get("test-results"));`,
    `                Files.write(Paths.get("test-results", "step-log.txt"), stepLog);`,
    `            } catch (Exception ignored) {`,
    `            }`,
    `        }`,
    `    }`,
    ``,
    `    @AfterEach`,
    `    void tearDown() {`,
    `        if (driver != null) driver.quit();`,
    `    }`,
    `}`,
    ``,
  ].join('\n');

  const pomCode = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<project xmlns="http://maven.apache.org/POM/4.0.0">`,
    `  <modelVersion>4.0.0</modelVersion>`,
    `  <groupId>com.testpilot.generated</groupId>`,
    `  <artifactId>${flowPascalName.toLowerCase()}-selenium</artifactId>`,
    `  <version>1.0.0</version>`,
    `  <properties>`,
    `    <maven.compiler.source>17</maven.compiler.source>`,
    `    <maven.compiler.target>17</maven.compiler.target>`,
    `  </properties>`,
    `  <dependencies>`,
    `    <dependency>`,
    `      <groupId>org.seleniumhq.selenium</groupId>`,
    `      <artifactId>selenium-java</artifactId>`,
    `      <version>4.27.0</version>`,
    `    </dependency>`,
    `    <dependency>`,
    `      <groupId>org.junit.jupiter</groupId>`,
    `      <artifactId>junit-jupiter</artifactId>`,
    `      <version>5.11.4</version>`,
    `      <scope>test</scope>`,
    `    </dependency>`,
    `  </dependencies>`,
    `  <build>`,
    `    <plugins>`,
    `      <plugin>`,
    `        <groupId>org.apache.maven.plugins</groupId>`,
    `        <artifactId>maven-surefire-plugin</artifactId>`,
    `        <version>3.5.2</version>`,
    `      </plugin>`,
    `    </plugins>`,
    `  </build>`,
    `</project>`,
    ``,
  ].join('\n');

  return {
    files: [...pageObjectFiles, { fileName: `${dataClassName}.java`, code: dataCode, role: 'FIXTURE' }, { fileName: `${testClassName}.java`, code: testCode, role: 'SPEC' }, { fileName: 'pom.xml', code: pomCode, role: 'CONFIG' }],
    command: `mvn test -Dtest=${testClassName}`,
  };
}
