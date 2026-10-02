from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Product(Base, TimestampMixin):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    product_type: Mapped[str] = mapped_column(String(50), default="SAP GUI")
    environment: Mapped[str] = mapped_column(String(120), default="QA")
    entry_point: Mapped[str] = mapped_column(String(500), default="")
    app_path_or_url: Mapped[str] = mapped_column(String(500), default="")
    default_framework: Mapped[str] = mapped_column(String(120), default="SAP_GUI_VBSCRIPT")
    owner: Mapped[str] = mapped_column(String(120), default="QA Manager")
    description: Mapped[str] = mapped_column(Text, default="")
    business_criticality: Mapped[str] = mapped_column(String(80), default="Medium")
    automation_risk_level: Mapped[str] = mapped_column(String(80), default="Medium")
    readiness_score: Mapped[float] = mapped_column(Float, default=0)

    modules: Mapped[list["Module"]] = relationship(back_populates="product", cascade="all, delete-orphan")
    knowledge_sources: Mapped[list["KnowledgeSource"]] = relationship(cascade="all, delete-orphan")
    objects: Mapped[list["ObjectRepository"]] = relationship(cascade="all, delete-orphan")
    test_cases: Mapped[list["TestCase"]] = relationship(cascade="all, delete-orphan")


class Module(Base, TimestampMixin):
    __tablename__ = "modules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")

    product: Mapped[Product] = relationship(back_populates="modules")
    features: Mapped[list["Feature"]] = relationship(back_populates="module", cascade="all, delete-orphan")


class Feature(Base, TimestampMixin):
    __tablename__ = "features"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    module_id: Mapped[int] = mapped_column(ForeignKey("modules.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")

    module: Mapped[Module] = relationship(back_populates="features")
    screens: Mapped[list["Screen"]] = relationship(cascade="all, delete-orphan")


class Screen(Base, TimestampMixin):
    __tablename__ = "screens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    feature_id: Mapped[int] = mapped_column(ForeignKey("features.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    platform: Mapped[str] = mapped_column(String(50), default="Hybrid")


class ObjectRepository(Base, TimestampMixin):
    __tablename__ = "object_repository"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    module: Mapped[str] = mapped_column(String(255), default="")
    feature: Mapped[str] = mapped_column(String(255), default="")
    screen: Mapped[str] = mapped_column(String(255), default="")
    area_or_tab: Mapped[str] = mapped_column(String(255), default="", nullable=True)
    screen_type: Mapped[str] = mapped_column(String(80), default="SCREEN", nullable=True)
    object_name: Mapped[str] = mapped_column(String(255))
    platform: Mapped[str] = mapped_column(String(50), default="Hybrid")
    object_type: Mapped[str] = mapped_column(String(80), default="input")
    technical_path: Mapped[str] = mapped_column(String(1000), default="")
    locator_strategy: Mapped[str] = mapped_column(String(120), default="", nullable=True)
    supported_actions: Mapped[list[str]] = mapped_column(JSON, default=list)
    scope: Mapped[str] = mapped_column(String(80), default="SCREEN", nullable=True)
    parent_screen_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parent_object_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    verification_status: Mapped[str] = mapped_column(String(80), default="Unverified", nullable=True)
    captured_from: Mapped[str] = mapped_column(String(255), default="", nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="Active")
    confidence: Mapped[float] = mapped_column(Float, default=80)
    aliases: Mapped[list[str]] = mapped_column(JSON, default=list)
    last_verified: Mapped[str] = mapped_column(String(120), default="")
    path_history: Mapped[list[dict]] = mapped_column(JSON, default=list)


class KnowledgeSource(Base, TimestampMixin):
    __tablename__ = "knowledge_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    source_type: Mapped[str] = mapped_column(String(80), default="User Guide")
    name: Mapped[str] = mapped_column(String(255))
    original_filename: Mapped[str] = mapped_column(String(255), default="")
    filename: Mapped[str] = mapped_column(String(255), default="")
    file_path: Mapped[str] = mapped_column(String(1000), default="")
    file_type: Mapped[str] = mapped_column(String(120), default="")
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    content_type: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(50), default="uploaded")
    error_message: Mapped[str] = mapped_column(Text, default="")
    extracted_text_preview: Mapped[str] = mapped_column(Text, default="")
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class KnowledgeChunk(Base, TimestampMixin):
    __tablename__ = "knowledge_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("knowledge_sources.id", ondelete="CASCADE"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)
    content: Mapped[str] = mapped_column(Text)
    chunk_text: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    embedding_text: Mapped[str] = mapped_column(Text, default="")
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class KnowledgeSummary(Base, TimestampMixin):
    __tablename__ = "knowledge_summaries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), unique=True)
    readiness: Mapped[float] = mapped_column(Float, default=0)
    modules: Mapped[list[str]] = mapped_column(JSON, default=list)
    features: Mapped[list[str]] = mapped_column(JSON, default=list)
    modules_detected: Mapped[list[str]] = mapped_column(JSON, default=list)
    features_detected: Mapped[list[str]] = mapped_column(JSON, default=list)
    business_rules: Mapped[list[str]] = mapped_column(JSON, default=list)
    validations: Mapped[list[str]] = mapped_column(JSON, default=list)
    expected_messages: Mapped[list[str]] = mapped_column(JSON, default=list)
    gaps: Mapped[list[str]] = mapped_column(JSON, default=list)
    missing_gaps: Mapped[list[str]] = mapped_column(JSON, default=list)
    what_ai_learned: Mapped[list[str]] = mapped_column(JSON, default=list)
    what_ai_is_unsure_about: Mapped[list[str]] = mapped_column(JSON, default=list)
    readiness_score: Mapped[float] = mapped_column(Float, default=0)
    ai_raw_response: Mapped[str] = mapped_column(Text, default="")
    suggestions: Mapped[list[str]] = mapped_column(JSON, default=list)
    ai_warning: Mapped[str] = mapped_column(Text, default="")


class TestCase(Base, TimestampMixin):
    __tablename__ = "test_cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    external_id: Mapped[str] = mapped_column(String(120), index=True)
    title: Mapped[str] = mapped_column(String(500))
    module: Mapped[str] = mapped_column(String(255), default="")
    feature: Mapped[str] = mapped_column(String(255), default="")
    source: Mapped[str] = mapped_column(String(80), default="Manual")
    priority: Mapped[str] = mapped_column(String(50), default="Medium")
    steps_text: Mapped[str] = mapped_column(Text, default="")
    expected_result: Mapped[str] = mapped_column(Text, default="")
    readiness: Mapped[float] = mapped_column(Float, default=0)
    quality_score: Mapped[float] = mapped_column(Float, default=0)
    risk_score: Mapped[float] = mapped_column(Float, default=0)
    duplicate_group: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(50), default="Imported")
    analysis_result: Mapped[dict] = mapped_column(JSON, default=dict)

    steps: Mapped[list["TestStep"]] = relationship(back_populates="test_case", cascade="all, delete-orphan", order_by="TestStep.step_order")
    scripts: Mapped[list["GeneratedScript"]] = relationship(cascade="all, delete-orphan")


class TestStep(Base, TimestampMixin):
    __tablename__ = "test_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    test_case_id: Mapped[int] = mapped_column(ForeignKey("test_cases.id", ondelete="CASCADE"))
    step_order: Mapped[int] = mapped_column(Integer)
    instruction: Mapped[str] = mapped_column(Text)
    expected_result: Mapped[str] = mapped_column(Text, default="")

    test_case: Mapped[TestCase] = relationship(back_populates="steps")
    mappings: Mapped[list["StepMapping"]] = relationship(back_populates="test_step", cascade="all, delete-orphan")


class StepMapping(Base, TimestampMixin):
    __tablename__ = "step_mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=True)
    test_case_id: Mapped[int | None] = mapped_column(ForeignKey("test_cases.id", ondelete="CASCADE"), nullable=True)
    test_step_id: Mapped[int] = mapped_column(ForeignKey("test_steps.id", ondelete="CASCADE"))
    step_number: Mapped[int] = mapped_column(Integer, default=0)
    manual_step: Mapped[str] = mapped_column(Text, default="")
    object_id: Mapped[int | None] = mapped_column(ForeignKey("object_repository.id", ondelete="SET NULL"), nullable=True)
    mapped_object_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ai_understanding: Mapped[str] = mapped_column(Text)
    automation_action: Mapped[str] = mapped_column(String(120), default="review")
    test_data: Mapped[str] = mapped_column(Text, default="")
    expected_result: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[float] = mapped_column(Float, default=0)
    risk_score: Mapped[float] = mapped_column(Float, default=0)
    selected_reason: Mapped[str] = mapped_column(Text, default="")
    alternative_objects: Mapped[list[str]] = mapped_column(JSON, default=list)
    ai_raw_response: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(50), default="needs_review")
    approved: Mapped[bool] = mapped_column(Boolean, default=False)

    test_step: Mapped[TestStep] = relationship(back_populates="mappings")
    object: Mapped[ObjectRepository | None] = relationship()


class GeneratedScript(Base, TimestampMixin):
    __tablename__ = "generated_scripts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    test_case_id: Mapped[int] = mapped_column(ForeignKey("test_cases.id", ondelete="CASCADE"))
    framework: Mapped[str] = mapped_column(String(120))
    code: Mapped[str] = mapped_column(Text)
    file_name: Mapped[str] = mapped_column(String(255), default="")
    file_path: Mapped[str] = mapped_column(String(1000), default="")
    command: Mapped[str] = mapped_column(String(1000), default="")
    review_json: Mapped[dict] = mapped_column(JSON, default=dict)
    risk_score: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(50), default="Draft")
    review_status: Mapped[str] = mapped_column(String(50), default="Draft")


class ExecutionRun(Base, TimestampMixin):
    __tablename__ = "execution_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    script_id: Mapped[int] = mapped_column(ForeignKey("generated_scripts.id", ondelete="CASCADE"))
    test_case_id: Mapped[int | None] = mapped_column(ForeignKey("test_cases.id", ondelete="CASCADE"), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="READY_TO_RUN")
    duration_seconds: Mapped[float] = mapped_column(Float, default=0)
    logs: Mapped[list[str]] = mapped_column(JSON, default=list)
    evidence_path: Mapped[str] = mapped_column(String(500), default="")
    command: Mapped[str] = mapped_column(String(1000), default="")
    failure_analysis_json: Mapped[dict] = mapped_column(JSON, default=dict)


class ExecutionStepResult(Base, TimestampMixin):
    __tablename__ = "execution_step_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    execution_id: Mapped[int] = mapped_column(ForeignKey("execution_runs.id", ondelete="CASCADE"))
    step_order: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(255))
    instruction: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(50))
    duration_seconds: Mapped[float] = mapped_column(Float, default=0)
    message: Mapped[str] = mapped_column(Text, default="")


class AutoHealSuggestion(Base, TimestampMixin):
    __tablename__ = "auto_heal_suggestions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=True)
    execution_id: Mapped[int | None] = mapped_column(ForeignKey("execution_runs.id", ondelete="CASCADE"), nullable=True)
    object_id: Mapped[int | None] = mapped_column(ForeignKey("object_repository.id", ondelete="SET NULL"), nullable=True)
    old_path: Mapped[str] = mapped_column(String(1000), default="")
    suggested_path: Mapped[str] = mapped_column(String(1000), default="")
    reason: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[float] = mapped_column(Float, default=0)
    risk_score: Mapped[float] = mapped_column(Float, default=0)
    ai_raw_response: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(50), default="Pending Review")
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class IntegrationConfig(Base, TimestampMixin):
    __tablename__ = "integration_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=True)
    integration_type: Mapped[str] = mapped_column(String(80))
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class HistoryEvent(Base, TimestampMixin):
    __tablename__ = "history_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=True)
    actor: Mapped[str] = mapped_column(String(120), default="User")
    action: Mapped[str] = mapped_column(String(255))
    entity_type: Mapped[str] = mapped_column(String(120))
    entity_id: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(50), default="Success")
    details: Mapped[str] = mapped_column(Text, default="")
    before_value: Mapped[str] = mapped_column(Text, default="")
    after_value: Mapped[str] = mapped_column(Text, default="")


class UserSetting(Base, TimestampMixin):
    __tablename__ = "user_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(120), default="default", unique=True)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
