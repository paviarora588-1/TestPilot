Feature: Role search

  Scenario: Validate role search result
    Given I open the configured product
    When I search for role "AM_ANALYST"
    Then the result table should contain "AM_ANALYST"

# Step definitions are intentionally placeholders for the MVP.
