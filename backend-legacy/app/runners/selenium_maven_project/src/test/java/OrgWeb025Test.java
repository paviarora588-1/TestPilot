import org.openqa.selenium.By;
import org.openqa.selenium.PageLoadStrategy;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.openqa.selenium.support.ui.Select;
import org.openqa.selenium.OutputType;
import org.openqa.selenium.TakesScreenshot;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.Duration;

public class OrgWeb025Test {
  @Test
  public void generatedAutomation() {
    ChromeOptions options = new ChromeOptions();
    // EAGER: proceed once the DOM is interactive instead of waiting on every last
    // font/analytics/third-party resource under the default "normal" strategy.
    options.setPageLoadStrategy(PageLoadStrategy.EAGER);
    WebDriver driver = new ChromeDriver(options);
    // Many apps render key UI client-side (React/Vue/Angular) after EAGER returns, so
    // every lookup waits for the element rather than assuming the DOM is already there.
    WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(20));
    try {
      driver.get(System.getenv().getOrDefault("PRODUCT_URL", "http://localhost"));
      // Open https://opensource-demo.orangehrmlive.com/web/index.php/auth/login
      // TODO open using locator: body > div > div.orangehrm-login-layout:nth-of-type(1) > div.orangehrm-login-layout-blob > div.orangehrm-login-container:nth-of-type(1) > div.orangehrm-login-slot-wrapper > div.orangehrm-login-slot:nth-of-type(2) > div.orangehrm-login-form:nth-of-type(2) > form.oxd-form > div.oxd-form-actions.orangehrm-login-action:nth-of-type(3) > button.oxd-button.oxd-button--medium
      // Login using Admin / admin123
      try {
        wait.until(ExpectedConditions.presenceOfElementLocated(By.cssSelector("input[name=\"username\"]"))).sendKeys("using Admin / admin123");
        System.out.println("Step 2: Login using Admin / admin123 passed");
      } catch (Throwable stepError) {
        System.out.println("Step 2: Login using Admin / admin123 failed: " + (stepError.getMessage() == null ? "unknown error" : stepError.getMessage().split("\\n")[0]));
        throw stepError;
      }
      // Click Admin
      try {
        wait.until(ExpectedConditions.elementToBeClickable(By.cssSelector("body > div > div.oxd-layout.orangehrm-upgrade-layout:nth-of-type(1) > div.oxd-layout-navigation:nth-of-type(1) > aside.oxd-sidepanel > nav.oxd-navbar-nav > div.oxd-sidepanel-body:nth-of-type(2) > ul.oxd-main-menu > li.oxd-main-menu-item-wrapper:nth-of-type(1) > a.oxd-main-menu-item"))).click();
        System.out.println("Step 3: Click Admin passed");
      } catch (Throwable stepError) {
        System.out.println("Step 3: Click Admin failed: " + (stepError.getMessage() == null ? "unknown error" : stepError.getMessage().split("\\n")[0]));
        throw stepError;
      }
      // Click PIM
      try {
        wait.until(ExpectedConditions.elementToBeClickable(By.cssSelector("body > div > div.oxd-layout.orangehrm-upgrade-layout:nth-of-type(1) > div.oxd-layout-navigation:nth-of-type(1) > aside.oxd-sidepanel > nav.oxd-navbar-nav > div.oxd-sidepanel-body:nth-of-type(2) > ul.oxd-main-menu > li.oxd-main-menu-item-wrapper:nth-of-type(2) > a.oxd-main-menu-item"))).click();
        System.out.println("Step 4: Click PIM passed");
      } catch (Throwable stepError) {
        System.out.println("Step 4: Click PIM failed: " + (stepError.getMessage() == null ? "unknown error" : stepError.getMessage().split("\\n")[0]));
        throw stepError;
      }
      // Click Leave
      try {
        wait.until(ExpectedConditions.elementToBeClickable(By.cssSelector("body > div > div.oxd-layout.orangehrm-upgrade-layout:nth-of-type(1) > div.oxd-layout-navigation:nth-of-type(1) > aside.oxd-sidepanel > nav.oxd-navbar-nav > div.oxd-sidepanel-body:nth-of-type(2) > ul.oxd-main-menu > li.oxd-main-menu-item-wrapper:nth-of-type(3) > a.oxd-main-menu-item"))).click();
        System.out.println("Step 5: Click Leave passed");
      } catch (Throwable stepError) {
        System.out.println("Step 5: Click Leave failed: " + (stepError.getMessage() == null ? "unknown error" : stepError.getMessage().split("\\n")[0]));
        throw stepError;
      }
      // Click Recruitment
      try {
        wait.until(ExpectedConditions.elementToBeClickable(By.cssSelector("body > div > div.oxd-layout.orangehrm-upgrade-layout:nth-of-type(1) > div.oxd-layout-navigation:nth-of-type(1) > aside.oxd-sidepanel > nav.oxd-navbar-nav > div.oxd-sidepanel-body:nth-of-type(2) > ul.oxd-main-menu > li.oxd-main-menu-item-wrapper:nth-of-type(5) > a.oxd-main-menu-item"))).click();
        System.out.println("Step 6: Click Recruitment passed");
      } catch (Throwable stepError) {
        System.out.println("Step 6: Click Recruitment failed: " + (stepError.getMessage() == null ? "unknown error" : stepError.getMessage().split("\\n")[0]));
        throw stepError;
      }
      // Click Dashboard
      try {
        wait.until(ExpectedConditions.elementToBeClickable(By.cssSelector("body > div > div.oxd-layout.orangehrm-upgrade-layout:nth-of-type(1) > div.oxd-layout-navigation:nth-of-type(1) > aside.oxd-sidepanel > nav.oxd-navbar-nav > div.oxd-sidepanel-body:nth-of-type(2) > ul.oxd-main-menu > li.oxd-main-menu-item-wrapper:nth-of-type(8) > a.oxd-main-menu-item"))).click();
        System.out.println("Step 7: Click Dashboard passed");
      } catch (Throwable stepError) {
        System.out.println("Step 7: Click Dashboard failed: " + (stepError.getMessage() == null ? "unknown error" : stepError.getMessage().split("\\n")[0]));
        throw stepError;
      }
      // Verify each page loads without error
      try {
        Assertions.assertTrue(wait.until(ExpectedConditions.presenceOfElementLocated(By.cssSelector("body > div > div.oxd-layout.orangehrm-upgrade-layout:nth-of-type(1) > div.oxd-layout-navigation:nth-of-type(1) > aside.oxd-sidepanel > nav.oxd-navbar-nav > div.oxd-sidepanel-header:nth-of-type(1) > a.oxd-brand"))).isDisplayed(), "Expected element not visible: a");
        captureEvidence(driver, "step-8-verify.png");
        System.out.println("Step 8: Verify each page loads without error passed");
      } catch (Throwable stepError) {
        System.out.println("Step 8: Verify each page loads without error failed: " + (stepError.getMessage() == null ? "unknown error" : stepError.getMessage().split("\\n")[0]));
        throw stepError;
      }
    } finally { driver.quit(); }
  }

  private static void captureEvidence(WebDriver driver, String fileName) {
    try {
      String evidenceDir = System.getenv().getOrDefault("EVIDENCE_DIR", "evidence");
      new File(evidenceDir).mkdirs();
      File shot = ((TakesScreenshot) driver).getScreenshotAs(OutputType.FILE);
      Files.copy(shot.toPath(), Paths.get(evidenceDir, fileName), StandardCopyOption.REPLACE_EXISTING);
      System.out.println("Evidence saved: " + Paths.get(evidenceDir, fileName));
    } catch (Exception evidenceError) {
      System.out.println("Evidence capture failed: " + evidenceError.getMessage());
    }
  }
}
