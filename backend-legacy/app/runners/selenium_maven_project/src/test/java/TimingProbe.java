import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.junit.jupiter.api.Test;

public class TimingProbe {
  @Test
  public void timed() {
    long t0 = System.currentTimeMillis();
    WebDriver driver = new ChromeDriver();
    long t1 = System.currentTimeMillis();
    System.out.println("PROBE: ChromeDriver session created in " + (t1 - t0) + " ms");
    try {
      driver.get("https://opensource-demo.orangehrmlive.com/web/index.php/auth/login");
      long t2 = System.currentTimeMillis();
      System.out.println("PROBE: driver.get() returned in " + (t2 - t1) + " ms");
      System.out.println("PROBE: page title = " + driver.getTitle());
    } finally {
      driver.quit();
    }
  }
}
