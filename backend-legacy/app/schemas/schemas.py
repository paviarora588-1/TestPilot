from typing import Any

from pydantic import BaseModel, Field


class ProductCreate(BaseModel):
    name: str
    product_type: str = "SAP GUI"
    environment: str = "QA"
    entry_point: str = ""
    app_path_or_url: str = ""
    default_framework: str = "SAP_GUI_VBSCRIPT"
    owner: str = "QA Manager"
    description: str = ""
    business_criticality: str = "Medium"
    automation_risk_level: str = "Medium"


class ModuleCreate(BaseModel):
    name: str
    description: str = ""


class FeatureCreate(BaseModel):
    name: str
    description: str = ""


class KnowledgeSourceCreate(BaseModel):
    name: str
    source_type: str = "User Guide"
    content: str | None = None


class ObjectCreate(BaseModel):
    object_name: str
    platform: str = "Hybrid"
    module: str = ""
    area_or_tab: str = ""
    feature: str = ""
    screen: str = ""
    screen_type: str = "SCREEN"
    object_type: str = "input"
    technical_path: str = ""
    locator_strategy: str = ""
    supported_actions: list[str] | str = Field(default_factory=list)
    scope: str = "SCREEN"
    parent_screen_id: int | None = None
    parent_object_id: int | None = None
    verification_status: str = "Unverified"
    captured_from: str = ""
    notes: str = ""
    aliases: list[str] | str = Field(default_factory=list)
    confidence: float = 80
    status: str = "Active"


class TestCaseCreate(BaseModel):
    external_id: str
    title: str
    module: str = ""
    feature: str = ""
    source: str = "Manual"
    expected_result: str = ""
    priority: str = "Medium"
    steps: list[str] | str = Field(default_factory=list)
    quality_score: float = 0
    risk_score: float = 0


class IntegrationConfigIn(BaseModel):
    jira_base_url: str = ""
    project_key: str = ""
    zephyr_token: str = ""
    cycle_name: str = ""
    folder: str = ""
    environment: str = ""


class SettingsIn(BaseModel):
    settings: dict[str, Any]


class ApiMessage(BaseModel):
    status: str = "ok"
    detail: str
    data: Any | None = None
