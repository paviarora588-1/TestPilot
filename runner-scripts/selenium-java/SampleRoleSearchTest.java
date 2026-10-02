// TestPilot AI Selenium Java sample
class SampleRoleSearchTest {
  WebDriver driver;

  void setup() {
    // TODO: initialize WebDriver
  }

  void searchRole(String roleName) {
    driver.get(System.getenv("PRODUCT_URL"));
    driver.findElement(By.xpath("//input[@placeholder='Role Name']")).sendKeys(roleName);
    driver.findElement(By.cssSelector("[data-testid='search']")).click();
    // TODO: assert result and capture screenshot
  }
}
