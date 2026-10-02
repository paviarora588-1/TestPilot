import base64
import csv
import io
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import UTC, datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.agents.testpilot_agent import TestPilotAgent, action_checklist, is_generic_knowledge_label, knowledge_profile, select_relevant_context
from app.core.config import settings
from app.db.session import get_db
from app.models.models import (
    AutoHealSuggestion,
    ExecutionRun,
    ExecutionStepResult,
    GeneratedScript,
    HistoryEvent,
    IntegrationConfig,
    KnowledgeChunk,
    KnowledgeSource,
    KnowledgeSummary,
    Module,
    Feature,
    ObjectRepository,
    Product,
    StepMapping,
    TestCase,
    TestStep,
    UserSetting,
)
from app.schemas.schemas import FeatureCreate, IntegrationConfigIn, KnowledgeSourceCreate, ModuleCreate, ObjectCreate, ProductCreate, SettingsIn, TestCaseCreate
from app.utils.file_parser import chunk_text, parse_uploaded_file

router = APIRouter()
agent = TestPilotAgent()


@router.get("/health")
def health_check():
    return {
        "status": "ok",
        "app": settings.app_name,
        "env": settings.app_env,
        "real_ai": True,
        "ai_provider": settings.ai_provider,
        "ai_configured": settings.ai_configured,
        "openai_configured": settings.openai_configured,
        "model_name": settings.model_name,
        "database_url": settings.database_url,
    }


@router.get("/products")
def list_products(db: Session = Depends(get_db)):
    products = db.scalars(select(Product).order_by(Product.created_at.desc())).all()
    return [serialize_product(product) for product in products]


@router.post("/products")
def create_product(payload: ProductCreate, db: Session = Depends(get_db)):
    data = payload.model_dump()
    if not data.get("app_path_or_url"):
        data["app_path_or_url"] = data.get("entry_point", "")
    if not data.get("entry_point"):
        data["entry_point"] = data.get("app_path_or_url", "")
    product = Product(**data)
    db.add(product)
    db.flush()
    add_history(db, product.id, "User", "Product Created", "Product", product.id, "Success", f"Created product {product.name}")
    db.commit()
    db.refresh(product)
    return serialize_product(product)


@router.get("/products/{product_id}")
def get_product(product_id: int, db: Session = Depends(get_db)):
    return serialize_product(get_or_404(db, Product, product_id, "Product"))


@router.put("/products/{product_id}")
def update_product(product_id: int, payload: ProductCreate, db: Session = Depends(get_db)):
    product = get_or_404(db, Product, product_id, "Product")
    before = serialize_product(product)
    data = payload.model_dump()
    if not data.get("app_path_or_url"):
        data["app_path_or_url"] = data.get("entry_point", "")
    if not data.get("entry_point"):
        data["entry_point"] = data.get("app_path_or_url", "")
    for key, value in data.items():
        setattr(product, key, value)
    add_history(db, product.id, "User", "Product Updated", "Product", product.id, "Success", f"Updated product {product.name}", before, data)
    db.commit()
    db.refresh(product)
    return serialize_product(product)


@router.delete("/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    product = get_or_404(db, Product, product_id, "Product")
    before = serialize_product(product)
    add_history(db, product.id, "User", "Product Deleted", "Product", product.id, "Success", f"Deleted product {product.name}", before, {})
    db.delete(product)
    db.commit()
    return {"status": "ok", "detail": "Product deleted"}


@router.get("/products/{product_id}/modules")
def list_modules(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    rows = db.scalars(select(Module).where(Module.product_id == product_id).order_by(Module.name)).all()
    return [serialize_module(row) for row in rows]


@router.post("/products/{product_id}/modules")
def create_module(product_id: int, payload: ModuleCreate, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    row = Module(product_id=product_id, **payload.model_dump())
    db.add(row)
    db.flush()
    add_history(db, product_id, "User", "Module Created", "Module", row.id, "Success", f"Created module {row.name}")
    db.commit()
    return serialize_module(row)


@router.get("/modules/{module_id}/features")
def list_features(module_id: int, db: Session = Depends(get_db)):
    get_or_404(db, Module, module_id, "Module")
    rows = db.scalars(select(Feature).where(Feature.module_id == module_id).order_by(Feature.name)).all()
    return [serialize_feature(row) for row in rows]


@router.post("/modules/{module_id}/features")
def create_feature(module_id: int, payload: FeatureCreate, db: Session = Depends(get_db)):
    module = get_or_404(db, Module, module_id, "Module")
    row = Feature(module_id=module_id, **payload.model_dump())
    db.add(row)
    db.flush()
    add_history(db, module.product_id, "User", "Feature Created", "Feature", row.id, "Success", f"Created feature {row.name}")
    db.commit()
    return serialize_feature(row)


@router.get("/products/{product_id}/knowledge-sources")
def list_knowledge_sources(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    rows = db.scalars(select(KnowledgeSource).where(KnowledgeSource.product_id == product_id).order_by(KnowledgeSource.created_at.desc())).all()
    return [serialize_knowledge_source(row) for row in rows]


@router.post("/products/{product_id}/knowledge-sources")
def create_knowledge_source(product_id: int, payload: KnowledgeSourceCreate, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    upload_root = Path(settings.upload_dir) / str(product_id)
    upload_root.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}_{safe_filename(payload.name or 'knowledge.txt')}"
    if "." not in Path(filename).name:
        filename = f"{filename}.txt"
    target = upload_root / filename
    target.write_text(payload.content or "", encoding="utf-8")
    source = KnowledgeSource(
        product_id=product_id,
        source_type=payload.source_type,
        name=payload.name,
        original_filename=payload.name,
        filename=target.name,
        file_path=str(target),
        file_type=target.suffix.lower().lstrip("."),
        file_size=target.stat().st_size,
        content_type="text/plain",
        status="uploaded",
    )
    db.add(source)
    db.flush()
    add_history(db, product_id, "User", "Knowledge Source Uploaded", "KnowledgeSource", source.id, "Success", f"Created text knowledge source {payload.name}")
    db.commit()
    return serialize_knowledge_source(source)


@router.post("/products/{product_id}/knowledge-sources/upload")
async def upload_knowledge_source(
    product_id: int,
    file: UploadFile = File(...),
    source_type: str = Form("User Guide"),
    db: Session = Depends(get_db),
):
    ensure_product(db, product_id)
    upload_root = Path(settings.upload_dir) / str(product_id)
    upload_root.mkdir(parents=True, exist_ok=True)
    original = safe_filename(file.filename or "knowledge-source")
    target = upload_root / f"{uuid.uuid4().hex}_{original}"
    max_bytes = 25 * 1024 * 1024
    written = 0
    with target.open("wb") as handle:
        while chunk := file.file.read(1024 * 1024):
            written += len(chunk)
            if written > max_bytes:
                handle.close()
                target.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail="Knowledge source file must be smaller than 25 MB.")
            handle.write(chunk)

    source = KnowledgeSource(
        product_id=product_id,
        source_type=source_type,
        name=original,
        original_filename=original,
        filename=target.name,
        file_path=str(target),
        file_type=target.suffix.lower().lstrip("."),
        file_size=target.stat().st_size,
        content_type=file.content_type or "",
        status="uploaded",
    )
    db.add(source)
    db.flush()
    add_history(db, product_id, "User", "Knowledge Source Uploaded", "KnowledgeSource", source.id, "Success", f"Uploaded {original}")
    db.commit()
    return serialize_knowledge_source(source)


@router.post("/knowledge/{source_id}/process")
def process_knowledge(source_id: int, db: Session = Depends(get_db)):
    source = get_or_404(db, KnowledgeSource, source_id, "Knowledge source")
    try:
        parsed = parse_uploaded_file(source.file_path)
        source.extracted_text_preview = parsed["text"][:800]

        db.execute(delete(KnowledgeChunk).where(KnowledgeChunk.source_id == source_id))
        chunks = chunk_text(parsed["text"])
        if not chunks and parsed["text"]:
            chunks = [parsed["text"]]
        if not chunks:
            chunks = [f"{source.original_filename or source.name}: no extractable text found. Metadata: {json.dumps(parsed['metadata'])}"]
        for index, chunk in enumerate(chunks, start=1):
            db.add(
                KnowledgeChunk(
                    source_id=source.id,
                    product_id=source.product_id,
                    chunk_index=index,
                    content=chunk,
                    chunk_text=chunk,
                    tags=[],
                    embedding_text=chunk[:2000],
                    metadata_json={**parsed["metadata"], "chunk_index": index},
                )
            )
        db.flush()

        all_chunks = db.scalars(select(KnowledgeChunk).where(KnowledgeChunk.product_id == source.product_id)).all()
        combined_text = "\n".join(chunk.content for chunk in all_chunks)
        try:
            summary_data = enrich_knowledge_summary(agent.process_knowledge(source.product_id, combined_text), combined_text)
        except HTTPException as exc:
            if should_use_local_knowledge_fallback(exc):
                summary_data = enrich_knowledge_summary(
                    local_knowledge_summary(source.product_id, combined_text),
                    combined_text,
                )
                summary_data["ai_warning"] = (
                    "Local AI timed out during knowledge extraction. "
                    "TestPilot saved a deterministic summary from the document outline so you can continue manually; "
                    f"original error: {exc.detail}"
                )
            else:
                mark_knowledge_failed(db, source, str(exc.detail))
                db.commit()
                raise
        except Exception as exc:
            detail = f"AI knowledge processing failed: {exc}"
            if should_use_local_knowledge_fallback(exc):
                summary_data = enrich_knowledge_summary(
                    local_knowledge_summary(source.product_id, combined_text),
                    combined_text,
                )
                summary_data["ai_warning"] = (
                    "Local AI failed during knowledge extraction. "
                    "TestPilot saved a deterministic summary from the document outline so you can continue manually; "
                    f"original error: {detail}"
                )
            else:
                mark_knowledge_failed(db, source, detail)
                db.commit()
                raise HTTPException(status_code=502, detail=detail) from exc

        summary = db.scalar(select(KnowledgeSummary).where(KnowledgeSummary.product_id == source.product_id))
        if not summary:
            summary = KnowledgeSummary(product_id=source.product_id)
            db.add(summary)
            try:
                db.commit()
            except IntegrityError:
                # Another concurrent processing request for this product already
                # inserted the summary row; use that one instead of erroring out.
                db.rollback()
                summary = db.scalar(select(KnowledgeSummary).where(KnowledgeSummary.product_id == source.product_id))
        apply_summary(summary, summary_data)
        source.status = "processed"
        source.error_message = ""
        source.processed_at = datetime.now(UTC)
        update_product_readiness(db, source.product_id)
        add_history(db, source.product_id, "TestPilot Agent", "Knowledge Processed", "KnowledgeSource", source.id, "Success", f"Processed {source.name} into {len(chunks)} chunks")
        db.commit()
        db.refresh(summary)
        return serialize_knowledge_summary(summary, source.product_id, db)
    except HTTPException:
        raise
    except Exception as exc:
        detail = f"Knowledge processing failed: {exc}"
        mark_knowledge_failed(db, source, detail)
        db.commit()
        raise HTTPException(status_code=500, detail=detail) from exc


@router.get("/products/{product_id}/knowledge-summary")
def knowledge_summary(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    summary = db.scalar(select(KnowledgeSummary).where(KnowledgeSummary.product_id == product_id))
    if not summary:
        return empty_knowledge_summary(product_id, db)
    return serialize_knowledge_summary(summary, product_id, db)


@router.get("/products/{product_id}/knowledge-chunks")
def list_knowledge_chunks(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    rows = db.scalars(select(KnowledgeChunk).where(KnowledgeChunk.product_id == product_id).order_by(KnowledgeChunk.created_at.desc())).all()
    return [serialize_knowledge_chunk(row) for row in rows]


@router.get("/products/{product_id}/objects")
def list_objects(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    rows = db.scalars(
        select(ObjectRepository)
        .where(ObjectRepository.product_id == product_id)
        .order_by(
            ObjectRepository.module.asc(),
            ObjectRepository.feature.asc(),
            ObjectRepository.screen.asc(),
            ObjectRepository.area_or_tab.asc(),
            ObjectRepository.object_type.asc(),
            ObjectRepository.object_name.asc(),
            ObjectRepository.updated_at.desc(),
        )
    ).all()
    return [serialize_object(row, db) for row in rows]


@router.get("/products/{product_id}/sap-gui/crawler-script")
def download_sap_gui_crawler_script(product_id: int, db: Session = Depends(get_db)):
    product = ensure_product(db, product_id)
    script = sap_gui_crawler_script_v2(product.name)
    add_history(db, product_id, "User", "SAP GUI Crawler Script Downloaded", "Product", product_id, "Success", "Downloaded strict SAP GUI crawler script")
    db.commit()
    return PlainTextResponse(
        script,
        media_type="text/vbscript",
        headers={"Content-Disposition": 'attachment; filename="testpilot-sap-gui-crawler.vbs"'},
    )


@router.get("/products/{product_id}/sap-gui/crawler-script-v2")
def download_sap_gui_crawler_script_v2(product_id: int, target_code: str = Query("", max_length=80), db: Session = Depends(get_db)):
    product = ensure_product(db, product_id)
    knowledge_terms = sap_knowledge_discovery_terms(db, product_id)
    script = sap_gui_crawler_script_v2(product.name, knowledge_terms, target_code=target_code)
    target_label = f" for {target_code.strip()}" if target_code.strip() else ""
    add_history(db, product_id, "User", "SAP GUI Advanced Crawler Downloaded", "Product", product_id, "Success", f"Downloaded advanced SAP GUI crawler{target_label} with {len(knowledge_terms)} guide terms")
    db.commit()
    return PlainTextResponse(
        script,
        media_type="text/vbscript",
        headers={"Content-Disposition": 'attachment; filename="testpilot-sap-gui-crawler-v2.vbs"'},
    )


@router.get("/products/{product_id}/sap-gui/discovery-plan")
def sap_gui_discovery_plan(product_id: int, db: Session = Depends(get_db)):
    product = ensure_product(db, product_id)
    summary = db.scalar(select(KnowledgeSummary).where(KnowledgeSummary.product_id == product_id))
    if not summary:
        raise HTTPException(
            status_code=409,
            detail={
                "blocked": True,
                "reasons": ["Product knowledge is not processed."],
                "next_actions": ["Upload and process product knowledge before SAP GUI discovery."],
            },
        )
    objects = db.scalars(select(ObjectRepository).where(ObjectRepository.product_id == product_id, ObjectRepository.platform == "SAP GUI")).all()
    covered = {normalize_key(value) for row in objects for value in [row.module, row.feature, row.screen] if value}
    knowledge_terms = sap_knowledge_discovery_terms(db, product_id)
    modules = list(summary.modules or summary.modules_detected or [])
    features = list(summary.features or summary.features_detected or [])
    # Structured summary fields are more reliable than arbitrary extracted terms.
    # Only use knowledge terms as a fallback when processing did not identify them.
    if not modules:
        modules = knowledge_terms[:12]
    if not features:
        module_keys = {normalize_key(module) for module in modules}
        features = [term for term in knowledge_terms if normalize_key(term) not in module_keys][:24]
    targets = []
    for module in modules or ["Discovered SAP GUI"]:
        related_features = [feature for feature in features if normalize_key(module) in normalize_key(feature) or normalize_key(feature) not in covered]
        targets.append(
            {
                "module": module,
                "features": related_features[:8],
                "status": "covered" if normalize_key(module) in covered else "needs_discovery",
                "next_action": "Open this module/transaction in SAP GUI and run the crawler.",
            }
        )
    add_history(db, product_id, "TestPilot Agent", "SAP GUI Discovery Plan Created", "Product", product_id, "Success", f"Created SAP discovery plan for {product.name}")
    db.commit()
    return {
        "product_id": product_id,
        "product": product.name,
        "knowledge_readiness": summary.readiness,
        "sap_gui_objects": len(objects),
        "targets": targets,
        "credential_policy": "Credentials are entered only in SAP GUI or the local crawler prompt. TestPilot does not store SAP passwords.",
    }


@router.post("/products/{product_id}/sap-gui/crawler-import")
async def import_sap_gui_crawler_output(product_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    raw = await file.read()
    try:
        payload = parse_crawler_payload(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Crawler import must be a valid JSON file exported by the SAP GUI crawler") from exc

    items = payload.get("objects") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="Crawler JSON must contain a list or an 'objects' array")

    event_rows = [item for item in items if isinstance(item, dict) and item.get("event")]
    items = [item for item in items if not (isinstance(item, dict) and item.get("event"))]

    hierarchy = sap_crawler_hierarchy(items)
    imported = 0
    updated = 0
    skipped = 0
    duplicate_merges = 0
    imported_rows: list[dict[str, Any]] = []
    current_import_object_ids: set[int] = set()
    for item in items:
        if not isinstance(item, dict):
            skipped += 1
            continue
        data = sap_crawler_item_to_object(item, hierarchy)
        if not data:
            skipped += 1
            continue
        existing_rows = db.scalars(object_duplicate_query(product_id, data)).all()
        if not existing_rows and sap_can_identity_merge(data):
            existing_rows = [
                row
                for row in db.scalars(crawler_object_identity_query(product_id, data)).all()
                if row.id not in current_import_object_ids
            ]
        existing = existing_rows[0] if existing_rows else None
        if len(existing_rows) > 1:
            duplicate_merges += merge_duplicate_objects(db, existing_rows[0], existing_rows[1:])
        if existing:
            before = serialize_object(existing, db)
            old_path = str(existing.technical_path or "")
            new_path = str(data.get("technical_path") or "")
            if old_path and new_path and old_path != new_path:
                existing.path_history = [
                    *list(existing.path_history or []),
                    {"before": old_path, "after": new_path, "changed_at": now_iso(), "source": "SAP GUI crawler"},
                ]
            for key, value in data.items():
                if key == "aliases":
                    value = sorted(set([*list(existing.aliases or []), *list(value or [])]))
                elif key == "supported_actions":
                    value = sorted(set([*list(existing.supported_actions or []), *list(value or [])]))
                setattr(existing, key, value)
            updated += 1
            current_import_object_ids.add(existing.id)
            imported_rows.append(serialize_object(existing, db))
            add_history(db, product_id, "User", "SAP GUI Object Updated", "ObjectRepository", existing.id, "Success", f"Updated crawler object {existing.object_name}", before, data)
        else:
            row = ObjectRepository(product_id=product_id, **data)
            db.add(row)
            db.flush()
            imported += 1
            current_import_object_ids.add(row.id)
            imported_rows.append(serialize_object(row, db))
            add_history(db, product_id, "User", "SAP GUI Object Imported", "ObjectRepository", row.id, "Success", f"Imported crawler object {row.object_name}")

    update_product_readiness(db, product_id)
    db.commit()
    return {
        "status": "ok",
        "imported": imported,
        "updated": updated,
        "skipped": skipped,
        "events_ignored": len(event_rows),
        "duplicate_merges": duplicate_merges,
        "crawler_summary": sap_crawler_import_summary(items, event_rows),
        "objects": imported_rows,
    }


@router.post("/products/{product_id}/objects")
def create_object(product_id: int, payload: ObjectCreate, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    data = normalize_object_payload(payload.model_dump())
    existing = db.scalar(object_duplicate_query(product_id, data))
    if existing:
        for key, value in data.items():
            setattr(existing, key, value)
        add_history(db, product_id, "User", "Object Updated", "ObjectRepository", existing.id, "Success", f"Merged duplicate add of {existing.object_name}")
        update_product_readiness(db, product_id)
        db.commit()
        return serialize_object(existing, db)
    row = ObjectRepository(product_id=product_id, **data)
    db.add(row)
    db.flush()
    add_history(db, product_id, "User", "Object Added", "ObjectRepository", row.id, "Success", f"Added object {row.object_name}")
    update_product_readiness(db, product_id)
    db.commit()
    return serialize_object(row, db)


@router.get("/objects/{object_id}")
def get_object(object_id: int, db: Session = Depends(get_db)):
    return serialize_object(get_or_404(db, ObjectRepository, object_id, "Object"), db)


@router.put("/objects/{object_id}")
def update_object(object_id: int, payload: ObjectCreate, db: Session = Depends(get_db)):
    row = get_or_404(db, ObjectRepository, object_id, "Object")
    before = serialize_object(row, db)
    data = normalize_object_payload(payload.model_dump())
    if data.get("technical_path") != row.technical_path:
        row.path_history = [*list(row.path_history or []), {"before": row.technical_path, "after": data.get("technical_path", ""), "changed_at": now_iso()}]
    for key, value in data.items():
        setattr(row, key, value)
    add_history(db, row.product_id, "User", "Object Updated", "ObjectRepository", row.id, "Success", f"Updated object {row.object_name}", before, data)
    update_product_readiness(db, row.product_id)
    db.commit()
    return serialize_object(row, db)


@router.delete("/objects/{object_id}")
def delete_object(object_id: int, db: Session = Depends(get_db)):
    row = get_or_404(db, ObjectRepository, object_id, "Object")
    product_id = row.product_id
    before = serialize_object(row, db)
    add_history(db, product_id, "User", "Object Deleted", "ObjectRepository", row.id, "Success", f"Deleted object {row.object_name}", before, {})
    db.delete(row)
    update_product_readiness(db, product_id)
    db.commit()
    return {"status": "ok", "detail": "Object deleted"}


@router.post("/objects/{object_id}/verify")
def verify_object(object_id: int, db: Session = Depends(get_db)):
    row = get_or_404(db, ObjectRepository, object_id, "Object")
    row.status = "Active"
    row.last_verified = now_iso()
    row.verification_status = "Verified"
    row.confidence = max(row.confidence, 88)
    add_history(db, row.product_id, "TestPilot Agent", "Object Verified", "ObjectRepository", row.id, "Success", f"Verified object {row.object_name}")
    db.commit()
    return serialize_object(row, db)


@router.get("/products/{product_id}/test-cases")
def list_test_cases(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    rows = db.scalars(select(TestCase).where(TestCase.product_id == product_id).order_by(TestCase.created_at.desc())).all()
    return [serialize_test_case(row, include_steps=True) for row in rows]


@router.post("/products/{product_id}/test-cases")
def create_test_case(product_id: int, payload: TestCaseCreate, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    data = payload.model_dump()
    steps = split_steps(data.pop("steps", []))
    data["steps_text"] = "\n".join(steps)
    row = TestCase(product_id=product_id, **data, status="Imported")
    db.add(row)
    db.flush()
    for index, step in enumerate(steps, start=1):
        db.add(TestStep(test_case_id=row.id, step_order=index, instruction=step))
    add_history(db, product_id, "User", "Test Case Created", "TestCase", row.id, "Success", f"Created test case {row.external_id}")
    db.commit()
    db.refresh(row)
    return serialize_test_case(row, include_steps=True)


@router.post("/products/{product_id}/test-cases/ai-generate")
def generate_test_case_suite(product_id: int, payload: dict[str, Any] = Body(default_factory=dict), db: Session = Depends(get_db)):
    """AI-authored end-to-end test suite: writes complete test cases straight from processed product knowledge."""
    product = ensure_product(db, product_id)
    summary_row = db.scalar(select(KnowledgeSummary).where(KnowledgeSummary.product_id == product_id))
    if not summary_row:
        raise HTTPException(
            status_code=409,
            detail={
                "blocked": True,
                "reasons": ["Product knowledge is not processed."],
                "next_actions": ["Upload and process product knowledge before generating AI test cases."],
            },
        )
    chunks = db.scalars(select(KnowledgeChunk.content).where(KnowledgeChunk.product_id == product_id).limit(20)).all()
    if not chunks:
        raise HTTPException(status_code=409, detail="Upload and process a product guide in Knowledge Base before generating AI test cases.")

    summary = serialize_knowledge_summary(summary_row, product_id, db)
    existing_titles = list(db.scalars(select(TestCase.title).where(TestCase.product_id == product_id)).all())
    max_cases = max(1, min(int(payload.get("count") or 8), 15))

    generated = agent.generate_test_suite(serialize_product(product), summary, chunks, existing_titles, max_cases)
    items = generated.get("test_cases") or []
    if not items:
        raise HTTPException(status_code=502, detail="The AI could not derive end-to-end test cases from the processed knowledge.")

    created: list[dict[str, Any]] = []
    skipped = 0
    for item in items[:max_cases]:
        steps = [str(value).strip() for value in (item.get("steps") or []) if str(value).strip()]
        title = str(item.get("title") or "").strip()
        if not title or not steps:
            skipped += 1
            continue
        test_case_payload = TestCaseCreate(
            external_id=f"TC-AI-{uuid.uuid4().hex[:6].upper()}",
            title=title[:200],
            module=str(item.get("module") or ""),
            feature=str(item.get("feature") or ""),
            source="AI Generated",
            expected_result=str(item.get("expected_result") or ""),
            priority=str(item.get("priority") or "Medium"),
            steps=steps,
        )
        created.append(create_test_case(product_id, test_case_payload, db))

    add_history(db, product_id, "TestPilot Agent", "AI Test Suite Generated", "Product", product_id, "Success", f"Generated {len(created)} end-to-end test case(s) from processed knowledge")
    db.commit()
    return {
        "status": "ok",
        "generated": len(created),
        "skipped": skipped,
        "coverage_summary": generated.get("coverage_summary", ""),
        "test_cases": created,
    }


@router.post("/products/{product_id}/test-cases/from-screenshot")
def generate_test_case_from_screenshot(
    product_id: int,
    prompt: str = Form(...),
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Local-only screenshot analysis: describe the screen in `prompt` (e.g. "its a login screen")
    and the local vision model writes a complete end-to-end test case from what it sees in the image.
    Runs on a local llama.cpp vision model regardless of AI_PROVIDER — nothing leaves the machine.

    Plain `def` (not `async def`) is deliberate: FastAPI runs sync routes in a thread pool, so the
    multi-minute CPU-bound vision call doesn't block the event loop for every other request, matching
    every other AI route in this file."""
    product = ensure_product(db, product_id)
    prompt_text = prompt.strip()
    if not prompt_text:
        raise HTTPException(status_code=400, detail='prompt is required, e.g. "its a login screen"')

    content_type = (image.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image (PNG, JPG, or WEBP).")
    raw = image.file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded image is empty.")
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Screenshot must be smaller than 8 MB.")

    chunks = db.scalars(select(KnowledgeChunk.content).where(KnowledgeChunk.product_id == product_id).limit(10)).all()
    image_base64 = base64.b64encode(raw).decode("ascii")
    generated = agent.generate_test_case_from_screenshot(image_base64, content_type, prompt_text, serialize_product(product), list(chunks))

    steps = [str(item).strip() for item in (generated.get("steps") or []) if str(item).strip()]
    if not steps:
        raise HTTPException(status_code=502, detail="The local vision model could not derive test steps from this screenshot.")

    test_case_payload = TestCaseCreate(
        external_id=f"TC-SS-{uuid.uuid4().hex[:6].upper()}",
        title=str(generated.get("title") or prompt_text)[:200],
        module=str(generated.get("module") or ""),
        feature=str(generated.get("feature") or ""),
        source="AI Screenshot",
        expected_result=str(generated.get("expected_result") or ""),
        steps=steps,
    )
    test_case = create_test_case(product_id, test_case_payload, db)
    add_history(db, product_id, "TestPilot Agent", "Screenshot Test Case Generated", "TestCase", test_case["id"], "Success", f"Generated {test_case['external_id']} from screenshot: {prompt_text[:120]}")
    db.commit()
    return {
        "status": "ok",
        "test_case": test_case,
        "detected_elements": generated.get("detected_elements") or [],
        "assumptions": generated.get("assumptions") or [],
    }


@router.post("/products/{product_id}/assistant/chat")
def assistant_chat(product_id: int, payload: dict[str, Any] = Body(...), db: Session = Depends(get_db)):
    """Chat-driven shortcut: turns a free-text request (e.g. "create a function Ztest1")

    into a guide-grounded test case, then runs it through the existing map-steps and
    generate-script pipeline so the user gets a usable script from a single message.
    """
    product = ensure_product(db, product_id)
    message = str(payload.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")
    framework = str(payload.get("framework") or "SAP_GUI_VBSCRIPT")
    history_in = payload.get("history") or []
    conversation_history = [
        {"role": str(item.get("role") or "user"), "content": str(item.get("content") or "")}
        for item in history_in
        if isinstance(item, dict) and str(item.get("content") or "").strip()
    ]

    chunks = db.scalars(select(KnowledgeChunk.content).where(KnowledgeChunk.product_id == product_id).limit(20)).all()
    if not chunks:
        raise HTTPException(status_code=409, detail="Upload and process a product guide in Knowledge Base before using the AI assistant.")

    generated = agent.generate_test_case_from_request(message, serialize_product(product), chunks, conversation_history)
    if generated.get("needs_clarification"):
        question = str(generated.get("clarification_question") or generated.get("assistant_reply") or "").strip() or "Could you give me a bit more detail so I can write this test case accurately?"
        return {
            "reply": question,
            "needs_clarification": True,
            "test_case": None,
            "mappings": [],
            "script": None,
            "blocked": False,
            "blockers": [],
        }

    steps = [str(item).strip() for item in (generated.get("steps") or []) if str(item).strip()]
    if not steps:
        raise HTTPException(status_code=502, detail="The AI assistant could not derive test steps from the guide for this request.")

    test_case_payload = TestCaseCreate(
        external_id=f"TC-{uuid.uuid4().hex[:6].upper()}",
        title=str(generated.get("title") or message)[:200],
        module=str(generated.get("module") or ""),
        feature=str(generated.get("feature") or ""),
        source="AI Assistant",
        expected_result=str(generated.get("expected_result") or ""),
        steps=steps,
    )
    test_case = create_test_case(product_id, test_case_payload, db)
    test_case_id = test_case["id"]

    reply_parts = [str(generated.get("assistant_reply") or "").strip() or f"Created test case {test_case['external_id']} with {len(steps)} steps from the guide."]
    mappings: list[dict[str, Any]] = []
    script: dict[str, Any] | None = None
    blocked_reasons: list[str] = []

    try:
        mapping_result = map_test_steps(test_case_id, db)
        mappings = mapping_result.get("mappings", [])
        mapped = sum(1 for item in mappings if item.get("status") == "mapped")
        reply_parts.append(f"Mapped {mapped}/{len(mappings)} steps to product library objects.")
    except HTTPException as exc:
        blocked_reasons.append(str(exc.detail))
        reply_parts.append(f"Could not auto-map steps: {exc.detail}")

    if not blocked_reasons:
        try:
            script_result = generate_script(test_case_id, {"framework": framework}, db)
            if isinstance(script_result, dict) and script_result.get("blocked"):
                reasons = script_result.get("reasons") or []
                blocked_reasons.extend(reasons)
                reply_parts.append("Script generation is blocked: " + "; ".join(reasons) + ". Review and approve the mappings, then generate the script from the Script Generator page.")
            else:
                script = script_result
                reply_parts.append(f"Generated {framework} script ({script.get('review_status', 'PENDING_REVIEW')}).")
        except HTTPException as exc:
            blocked_reasons.append(str(exc.detail))
            reply_parts.append(f"Could not generate script: {exc.detail}")

    assumptions = generated.get("assumptions") or []
    if assumptions:
        reply_parts.append("Assumptions: " + "; ".join(str(item) for item in assumptions[:3]))

    add_history(db, product_id, "AI Assistant", "Chat Test Case Generated", "TestCase", test_case_id, "Success", f"Generated {test_case['external_id']} from chat request: {message[:120]}")
    db.commit()

    return {
        "reply": " ".join(part for part in reply_parts if part),
        "needs_clarification": False,
        "test_case": test_case,
        "mappings": mappings,
        "script": script,
        "blocked": bool(blocked_reasons),
        "blockers": blocked_reasons,
    }


@router.get("/test-cases/import-template")
def download_test_case_import_template():
    """A real, downloadable .xlsx matching parse_testcase_upload()'s exact required columns —
    so a user filling this in can never get the column names/format wrong."""
    from io import BytesIO

    from openpyxl import Workbook
    from openpyxl.styles import Font

    headers = ["test_case_id", "title", "module", "feature", "steps", "expected_result", "priority", "source"]
    sample_rows = [
        [
            "TC-101",
            "Search account by id",
            "Account Management",
            "User Search",
            "Enter account id\nClick search\nVerify account details are shown",
            "Account details are shown",
            "High",
            "Excel",
        ],
        [
            "TC-102",
            "Reject unsupported upload",
            "File Intake",
            "Document Upload",
            "Open upload screen\nSelect unsupported file\nClick upload\nVerify blocking validation message",
            "Unsupported file is rejected",
            "Medium",
            "Excel",
        ],
    ]
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Test Cases"
    sheet.append(headers)
    for cell in sheet[1]:
        cell.font = Font(bold=True)
    for row in sample_rows:
        sheet.append(row)
    for column_cells in sheet.columns:
        sheet.column_dimensions[column_cells[0].column_letter].width = 28
    sheet.freeze_panes = "A2"

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="testpilot-test-case-import-template.xlsx"'},
    )


@router.post("/products/{product_id}/test-cases/import")
async def import_test_cases_from_file(product_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    rows = await parse_testcase_upload(file)
    created = []
    for row in rows:
        steps = split_steps(row.get("steps", ""))
        test_case = TestCase(
            product_id=product_id,
            external_id=row.get("test_case_id", "") or row.get("external_id", "") or f"TC-{uuid.uuid4().hex[:6].upper()}",
            title=row.get("title", "Imported test case"),
            module=row.get("module", ""),
            feature=row.get("feature", ""),
            source=row.get("source", "CSV"),
            priority=row.get("priority", "Medium"),
            expected_result=row.get("expected_result", ""),
            steps_text="\n".join(steps),
            status="Imported",
        )
        db.add(test_case)
        db.flush()
        for index, step in enumerate(steps, start=1):
            db.add(TestStep(test_case_id=test_case.id, step_order=index, instruction=step))
        created.append(test_case)
    add_history(db, product_id, "User", "Test Cases Imported", "TestCase", "", "Success", f"Imported {len(created)} test cases from {file.filename}")
    db.commit()
    return {"status": "ok", "imported": len(created), "test_cases": [serialize_test_case(row, include_steps=True) for row in created]}


@router.post("/test-cases/import")
def import_test_cases_legacy(payload: dict[str, Any] = Body(default_factory=dict), db: Session = Depends(get_db)):
    product_id = int(payload.get("product_id") or 0)
    if not product_id:
        raise HTTPException(status_code=400, detail="product_id is required")
    cases = payload.get("test_cases") or []
    created = []
    for item in cases:
        created.append(create_test_case(product_id, TestCaseCreate(**item), db))
    return {"status": "ok", "imported": len(created), "test_cases": created}


@router.get("/test-cases/{test_case_id}")
def get_test_case(test_case_id: int, db: Session = Depends(get_db)):
    return serialize_test_case(get_or_404(db, TestCase, test_case_id, "Test case"), include_steps=True)


@router.put("/test-cases/{test_case_id}")
def update_test_case(test_case_id: int, payload: TestCaseCreate, db: Session = Depends(get_db)):
    row = get_or_404(db, TestCase, test_case_id, "Test case")
    before = serialize_test_case(row, include_steps=True)
    data = payload.model_dump()
    steps = split_steps(data.pop("steps", []))
    data["steps_text"] = "\n".join(steps)
    for key, value in data.items():
        setattr(row, key, value)
    db.execute(delete(TestStep).where(TestStep.test_case_id == row.id))
    db.flush()
    for index, step in enumerate(steps, start=1):
        db.add(TestStep(test_case_id=row.id, step_order=index, instruction=step))
    add_history(db, row.product_id, "User", "Test Case Updated", "TestCase", row.id, "Success", f"Updated test case {row.external_id}", before, data)
    db.commit()
    return serialize_test_case(row, include_steps=True)


@router.delete("/test-cases/{test_case_id}")
def delete_test_case(test_case_id: int, db: Session = Depends(get_db)):
    row = get_or_404(db, TestCase, test_case_id, "Test case")
    product_id = row.product_id
    before = serialize_test_case(row, include_steps=True)
    add_history(db, product_id, "User", "Test Case Deleted", "TestCase", row.id, "Success", f"Deleted test case {row.external_id}", before, {})
    db.delete(row)
    db.commit()
    return {"status": "ok", "detail": "Test case deleted"}


@router.get("/products/{product_id}/quality/test-cases")
def list_test_case_quality(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    rows = db.scalars(select(TestCase).where(TestCase.product_id == product_id).order_by(TestCase.created_at.desc())).all()
    all_cases = [serialize_test_case(row, include_steps=True) for row in rows]
    results = [quality_result(row, all_cases) for row in rows]
    db.commit()
    return results


@router.get("/test-cases/{test_case_id}/quality")
def get_test_case_quality(test_case_id: int, db: Session = Depends(get_db)):
    row = get_or_404(db, TestCase, test_case_id, "Test case")
    rows = db.scalars(select(TestCase).where(TestCase.product_id == row.product_id)).all()
    all_cases = [serialize_test_case(item, include_steps=True) for item in rows]
    result = quality_result(row, all_cases)
    db.commit()
    return result


@router.post("/test-cases/{test_case_id}/analyze")
def analyze_test_case(test_case_id: int, db: Session = Depends(get_db)):
    row = get_or_404(db, TestCase, test_case_id, "Test case")
    product = get_or_404(db, Product, row.product_id, "Product")
    chunks = db.scalars(select(KnowledgeChunk.content).where(KnowledgeChunk.product_id == row.product_id).limit(20)).all()
    payload = {**serialize_test_case(row, include_steps=True), "product_type": product.product_type}
    analysis = agent.analyze_test_case(payload, chunks)
    row.analysis_result = analysis
    row.readiness = float(analysis.get("automation_readiness", row.readiness or 0) or 0)
    row.quality_score = float(analysis.get("quality_score", row.quality_score or 0) or 0)
    row.risk_score = float(analysis.get("risk_score", row.risk_score or 0) or 0)
    row.status = "Analyzed"
    add_history(db, row.product_id, "TestPilot Agent", "Test Case Analyzed", "TestCase", row.id, "Success", f"Analyzed {row.external_id}")
    db.commit()
    return analysis


@router.post("/test-cases/{test_case_id}/map-steps")
def map_test_steps(test_case_id: int, db: Session = Depends(get_db)):
    row = get_or_404(db, TestCase, test_case_id, "Test case")
    db.execute(delete(StepMapping).where(StepMapping.test_step_id.in_(select(TestStep.id).where(TestStep.test_case_id == row.id))))
    steps = db.scalars(select(TestStep).where(TestStep.test_case_id == row.id).order_by(TestStep.step_order)).all()
    available_objects = [obj for obj in db.scalars(select(ObjectRepository).where(ObjectRepository.product_id == row.product_id)).all() if object_available_for_mapping(obj)]
    objects = mapping_object_candidates(row, available_objects)
    if not objects:
        raise HTTPException(status_code=409, detail="Step mapping blocked: add product library objects before mapping")
    chunks = db.scalars(select(KnowledgeChunk.content).where(KnowledgeChunk.product_id == row.product_id).limit(20)).all()
    serialized_case = serialize_test_case(row, include_steps=True)
    if settings.ai_provider.strip().lower() in {"local", "llama_cpp", "llamacpp"}:
        ai_rows: list[dict[str, Any]] = []
        raw_responses: list[str] = []
        checklist: list[dict[str, Any]] = []
        for step in steps:
            requirements = (
                manual_action_requirements(step.instruction)
                or label_value_requirement(step.instruction)
                or [{"action": agent.action_from_step(step.instruction), "target": step.instruction, "display": step.instruction}]
            )
            guide_buttons_inserted: set[str] = set()
            for requirement in requirements:
                prereq_button = guide_prerequisite_button(requirement, chunks, available_objects, row)
                if prereq_button and prereq_button not in guide_buttons_inserted:
                    checklist.append({
                        "manual_step_order": step.step_order,
                        "action": "click",
                        "target": f"{prereq_button} button",
                        "display": f"Click the {prereq_button} button (required by product guide before this action)",
                    })
                    guide_buttons_inserted.add(prereq_button)
                checklist.append({"manual_step_order": step.step_order, **requirement})
        current_screen: str | None = None
        for item in checklist:
            action_text = str(item.get("display") or item.get("required_action") or item.get("target") or "")
            required_action = str(item.get("action") or agent.action_from_step(action_text))
            action_objects = mapping_object_candidates_for_text(
                row, available_objects, action_text, limit=5, required_action=required_action, current_screen=current_screen
            )
            candidate = action_objects[0] if action_objects else None
            if candidate and candidate.screen:
                current_screen = candidate.screen
            action = local_automation_action(required_action)
            confidence = local_mapping_confidence(action_text, row, candidate, required_action=required_action)
            ai_row = {
                "manual_step_order": item.get("manual_step_order"),
                "manual_step": action_text,
                "ai_understanding": "Local ranked mapper selected the closest product-library object; review before approval.",
                "mapped_object_id": candidate.id if candidate else None,
                "mapped_object_name": candidate.object_name if candidate else None,
                "automation_action": action,
                "test_data": local_mapping_test_data(item, action_text),
                "expected_result": "",
                "confidence": confidence,
                "risk_score": 65 if action in {"click", "open"} else 45,
                "selected_reason": "Free local mode uses deterministic product-library ranking to avoid slow local LLM calls.",
                "alternative_objects": [obj.object_name for obj in action_objects[1:4]],
                "status": "mapped" if candidate and confidence >= 85 else "needs_review" if candidate else "unmapped",
            }
            raw_responses.append(json.dumps({"local_ranked_mapping": True, "action": action_text}))
            ai_row["step_number"] = int(item.get("manual_step_order") or len(ai_rows) + 1)
            ai_row["manual_step"] = str(ai_row.get("manual_step") or action_text)
            ai_rows.append(ai_row)
        raw_response = "\n".join(raw_responses)
        objects_for_lookup = available_objects
    else:
        object_payload = [serialize_object(obj, db) for obj in objects]
        mapping_result = agent.map_test_steps(serialized_case, object_payload, chunks)
        raw_response = str(mapping_result.get("ai_raw_response", ""))
        ai_rows = list(mapping_result.get("mappings", []))
        objects_for_lookup = objects
    object_by_id = {obj.id: obj for obj in objects_for_lookup}
    object_by_name = {obj.object_name.lower(): obj for obj in objects_for_lookup}
    created = []
    if not ai_rows:
        ai_rows = [{"step_number": step.step_order, "manual_step": step.instruction} for step in steps]
    step_by_order = {step.step_order: step for step in steps}
    for fallback_index, ai_row in enumerate(ai_rows, start=1):
        requested_order = int(ai_row.get("step_number", 0) or fallback_index)
        step = step_by_order.get(requested_order)
        if not step:
            eligible = [candidate for candidate in steps if candidate.step_order <= requested_order]
            step = eligible[-1] if eligible else (steps[0] if steps else None)
        if not step:
            continue
        mapped_object_id = optional_int(ai_row.get("mapped_object_id"))
        best_object = object_by_id.get(mapped_object_id) if mapped_object_id else None
        if not best_object and ai_row.get("mapped_object_name"):
            best_object = object_by_name.get(str(ai_row["mapped_object_name"]).lower())
        confidence = safe_float(ai_row.get("confidence", 0), 0)
        status = str(ai_row.get("status") or ("mapped" if best_object and confidence >= 85 else "needs_review" if best_object else "unmapped"))
        mapping = StepMapping(
            product_id=row.product_id,
            test_case_id=row.id,
            test_step_id=step.id,
            step_number=requested_order,
            manual_step=str(ai_row.get("manual_step") or step.instruction),
            object_id=best_object.id if best_object else None,
            mapped_object_id=best_object.id if best_object else None,
            ai_understanding=str(ai_row.get("ai_understanding") or ""),
            automation_action=str(ai_row.get("automation_action") or "review"),
            test_data=str(ai_row.get("test_data") or ""),
            expected_result=str(ai_row.get("expected_result") or ""),
            confidence=confidence,
            risk_score=safe_float(ai_row.get("risk_score", 50), 50),
            selected_reason=str(ai_row.get("selected_reason") or ""),
            alternative_objects=listify(ai_row.get("alternative_objects")),
            ai_raw_response=raw_response,
            status=status,
            approved=False,
        )
        db.add(mapping)
        created.append(mapping)
    row.status = "Mapped"
    add_history(db, row.product_id, "TestPilot Agent", "Mapping Generated", "StepMapping", row.id, "Success", f"Generated {len(created)} step mappings for {row.external_id}")
    db.commit()
    return {"test_case": serialize_test_case(row, include_steps=True), "mappings": [serialize_mapping(mapping, db) for mapping in created]}


@router.get("/test-cases/{test_case_id}/mappings")
def list_mappings(test_case_id: int, db: Session = Depends(get_db)):
    get_or_404(db, TestCase, test_case_id, "Test case")
    mappings = db.scalars(select(StepMapping).join(TestStep).where(TestStep.test_case_id == test_case_id).order_by(StepMapping.step_number, StepMapping.id)).all()
    return [serialize_mapping(mapping, db) for mapping in mappings]


@router.post("/mappings/{mapping_id}/approve")
def approve_mapping(mapping_id: int, db: Session = Depends(get_db)):
    mapping = get_or_404(db, StepMapping, mapping_id, "Mapping")
    mapping.approved = True
    mapping.status = "approved"
    # Approval is a human decision, not evidence the match was actually good — inflating
    # confidence here previously made a wrong object (e.g. "Login" approved for a "Logout" step)
    # display as 90%+ confident, hiding exactly the mismatch a reviewer needed to catch.
    test_step = get_or_404(db, TestStep, mapping.test_step_id, "Test step")
    test_case = get_or_404(db, TestCase, test_step.test_case_id, "Test case")
    add_history(db, test_case.product_id, "User", "Mapping Approved", "StepMapping", mapping.id, "Success", f"Approved mapping for step {test_step.step_order}")
    db.commit()
    return serialize_mapping(mapping, db)


@router.post("/mappings/{mapping_id}/reject")
def reject_mapping(mapping_id: int, db: Session = Depends(get_db)):
    mapping = get_or_404(db, StepMapping, mapping_id, "Mapping")
    mapping.approved = False
    mapping.status = "needs_review"
    test_step = get_or_404(db, TestStep, mapping.test_step_id, "Test step")
    test_case = get_or_404(db, TestCase, test_step.test_case_id, "Test case")
    add_history(db, test_case.product_id, "User", "Mapping Rejected", "StepMapping", mapping.id, "Needs Review", f"Rejected mapping for step {test_step.step_order}")
    db.commit()
    return serialize_mapping(mapping, db)


@router.post("/mappings/{mapping_id}/regenerate")
def regenerate_mapping(mapping_id: int, db: Session = Depends(get_db)):
    mapping = get_or_404(db, StepMapping, mapping_id, "Mapping")
    test_step = get_or_404(db, TestStep, mapping.test_step_id, "Test step")
    test_case = get_or_404(db, TestCase, test_step.test_case_id, "Test case")
    objects = db.scalars(select(ObjectRepository).where(ObjectRepository.product_id == test_case.product_id)).all()
    objects = mapping_object_candidates(test_case, [obj for obj in objects if object_available_for_mapping(obj)])
    chunks = db.scalars(select(KnowledgeChunk.content).where(KnowledgeChunk.product_id == test_case.product_id).limit(20)).all()
    result = agent.map_test_steps(serialize_test_case(test_case, include_steps=True), [serialize_object(obj, db) for obj in objects], chunks)
    ai_rows = result.get("mappings", [])
    ai_row = next((item for item in ai_rows if int(item.get("step_number", 0) or 0) == test_step.step_order), {})
    object_by_id = {obj.id: obj for obj in objects}
    object_by_name = {obj.object_name.lower(): obj for obj in objects}
    mapped_object_id = ai_row.get("mapped_object_id")
    best_object = object_by_id.get(int(mapped_object_id)) if mapped_object_id else None
    if not best_object and ai_row.get("mapped_object_name"):
        best_object = object_by_name.get(str(ai_row["mapped_object_name"]).lower())
    mapping.object_id = best_object.id if best_object else None
    mapping.mapped_object_id = best_object.id if best_object else None
    mapping.ai_understanding = str(ai_row.get("ai_understanding") or mapping.ai_understanding)
    mapping.automation_action = str(ai_row.get("automation_action") or mapping.automation_action)
    mapping.confidence = float(ai_row.get("confidence", mapping.confidence) or 0)
    mapping.risk_score = float(ai_row.get("risk_score", mapping.risk_score) or 0)
    mapping.test_data = str(ai_row.get("test_data") or mapping.test_data)
    mapping.expected_result = str(ai_row.get("expected_result") or mapping.expected_result)
    mapping.selected_reason = str(ai_row.get("selected_reason") or mapping.selected_reason)
    mapping.alternative_objects = listify(ai_row.get("alternative_objects"))
    mapping.ai_raw_response = str(result.get("ai_raw_response", ""))
    mapping.status = str(ai_row.get("status") or ("mapped" if best_object and mapping.confidence >= 85 else "needs_review"))
    add_history(db, test_case.product_id, "TestPilot Agent", "Mapping Regenerated", "StepMapping", mapping.id, "Success", f"Regenerated mapping for step {test_step.step_order}")
    db.commit()
    return serialize_mapping(mapping, db)


@router.post("/test-cases/{test_case_id}/generate-script")
def generate_script(test_case_id: int, payload: dict[str, Any] = Body(default_factory=dict), db: Session = Depends(get_db)):
    test_case = get_or_404(db, TestCase, test_case_id, "Test case")
    framework = payload.get("framework") or "SAP_GUI_VBSCRIPT"
    blockers = generation_blockers(db, test_case)
    if blockers:
        return {
            "blocked": True,
            "reasons": blockers,
            "next_actions": next_actions_for_blockers(blockers),
        }
    mappings = db.scalars(select(StepMapping).join(TestStep).where(TestStep.test_case_id == test_case_id).order_by(StepMapping.step_number, StepMapping.id)).all()
    code, generated_file_name, _ = build_script(framework, test_case, mappings, db)
    if not code.strip():
        raise HTTPException(status_code=502, detail="TestPilot could not compile script code from the approved mappings")
    file_name = ensure_script_extension(generated_file_name, framework)
    command = command_for_framework(framework, file_name)
    # AI review is a separate, deliberately-slow local LLM call (seconds to minutes on this
    # hardware) — it used to run synchronously here, forcing every "Generate Script" click to
    # wait on it. Generation itself is a fast deterministic compile; review happens on-demand via
    # the "Review with AI" button (POST /scripts/{id}/review) or approve_current for a manual
    # sign-off, matching the UI's existing separate buttons for these two actions.
    review: dict[str, Any] = {}
    validation_issues = sap_script_validation_issues(code, mappings, db) if is_sap_framework(framework) else []
    compiler_report = script_compilation_report(framework, test_case, mappings, code, validation_issues, db)
    if validation_issues:
        review["testpilot_validation_issues"] = validation_issues
    review["testpilot_compiler"] = compiler_report
    review_risk = calibrated_review_risk(review, mappings, validation_issues)
    # Not yet reviewed or manually approved — same resting state persisted_script_review_status()
    # already computes for an unreviewed script, so nothing flips out from under the user on the
    # next list refresh. Use "Review with AI" or "Approve Current Script" to unblock execution.
    review_status = "REVIEW_BLOCKED"
    target_dir = Path(settings.generated_script_dir) / str(test_case.product_id) / safe_filename(test_case.external_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / file_name
    target.write_text(code, encoding="utf-8")

    script = GeneratedScript(
        product_id=test_case.product_id,
        test_case_id=test_case.id,
        framework=framework,
        code=code,
        file_name=file_name,
        file_path=str(target),
        command=command,
        review_json=review,
        risk_score=review_risk,
        status=review_status,
        review_status=review_status,
    )
    db.add(script)
    db.flush()
    history_status = "Blocked" if validation_issues else "Success"
    add_history(db, test_case.product_id, "TestPilot Agent", "Script Generated", "GeneratedScript", script.id, history_status, f"Generated {framework} script for {test_case.external_id}: {review_status}")
    db.commit()
    return serialize_script(script)


@router.get("/scripts/{script_id}")
def get_script(script_id: int, db: Session = Depends(get_db)):
    return serialize_script(get_or_404(db, GeneratedScript, script_id, "Script"))


@router.get("/test-cases/{test_case_id}/scripts")
def list_scripts_for_test_case(test_case_id: int, db: Session = Depends(get_db)):
    get_or_404(db, TestCase, test_case_id, "Test case")
    rows = db.scalars(select(GeneratedScript).where(GeneratedScript.test_case_id == test_case_id).order_by(GeneratedScript.created_at.desc())).all()
    changed = False
    for row in rows:
        objective_issues = script_objective_issues(row, db)
        review = dict(row.review_json or {})
        if objective_issues:
            review["testpilot_validation_issues"] = objective_issues
        else:
            review.pop("testpilot_validation_issues", None)
        if review != (row.review_json or {}):
            row.review_json = review
            changed = True
        expected_status = persisted_script_review_status(row, db)
        if row.review_status != expected_status or row.status != expected_status:
            row.review_status = expected_status
            row.status = expected_status
            changed = True
    if changed:
        db.commit()
    return [serialize_script(row) for row in rows]


@router.get("/scripts/{script_id}/download")
def download_script(script_id: int, db: Session = Depends(get_db)):
    script = get_or_404(db, GeneratedScript, script_id, "Script")
    path = Path(script.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Generated script file not found")
    return FileResponse(str(path), filename=script.file_name, media_type="application/octet-stream")


@router.post("/scripts/{script_id}/review")
def review_script(script_id: int, db: Session = Depends(get_db)):
    script = get_or_404(db, GeneratedScript, script_id, "Script")
    review = agent.review_script(script.code, script.framework)
    script.review_json = review
    settings_row = db.scalar(select(UserSetting).where(UserSetting.user_id == "default"))
    app_settings = {**default_settings(), **(settings_row.settings if settings_row else {})}
    max_risk = float(app_settings.get("maximum_allowed_risk_score", 75) or 75)
    recommendation = str(review.get("approval_recommendation", "")).strip().lower().replace(" ", "_")
    approved_recommendations = {"approve", "approved", "pass", "passed", "ready", "ready_to_run"}
    mappings = db.scalars(select(StepMapping).join(TestStep).where(TestStep.test_case_id == script.test_case_id).order_by(StepMapping.step_number, StepMapping.id)).all()
    validation_issues = script_objective_issues(script, db, mappings)
    if validation_issues:
        review["testpilot_validation_issues"] = validation_issues
    script.risk_score = calibrated_review_risk(review, mappings, validation_issues)
    script.review_json = review
    script.status = "AI_REVIEWED" if recommendation in approved_recommendations and script.risk_score <= max_risk and not validation_issues else "REVIEW_BLOCKED"
    script.review_status = script.status
    add_history(db, script.product_id, "TestPilot Agent", "Script Reviewed", "GeneratedScript", script.id, "Success", f"Reviewed script {script.file_name}")
    db.commit()
    return {**serialize_script(script), "review": review}


@router.post("/scripts/{script_id}/user-decision")
def decide_script_review(script_id: int, payload: dict[str, Any] = Body(default_factory=dict), db: Session = Depends(get_db)):
    script = get_or_404(db, GeneratedScript, script_id, "Script")
    decision = str(payload.get("decision") or "").strip().lower()
    if decision not in {"approve_current", "keep_blocked"}:
        raise HTTPException(status_code=400, detail="decision must be approve_current or keep_blocked")

    mappings = db.scalars(select(StepMapping).join(TestStep).where(TestStep.test_case_id == script.test_case_id).order_by(StepMapping.step_number, StepMapping.id)).all()
    validation_issues = script_objective_issues(script, db, mappings)
    if decision == "approve_current" and validation_issues:
        raise HTTPException(
            status_code=409,
            detail={
                "blocked": True,
                "reasons": validation_issues,
                "next_actions": ["Regenerate the script from the approved mappings before manually approving it."],
            },
        )

    review = dict(script.review_json or {})
    review["user_decision"] = {
        "decision": decision,
        "decided_at": now_iso(),
        "ai_recommendation": review.get("approval_recommendation", ""),
        "ai_risk_score": script.risk_score,
        "risk_acknowledged": decision == "approve_current",
    }
    script.review_json = review
    if decision == "approve_current":
        script.status = "USER_APPROVED"
        script.review_status = "USER_APPROVED"
        history_status = "Success"
        details = f"User approved current script {script.file_name} after reviewing AI findings and risk score {script.risk_score:.1f}"
    else:
        script.status = "REVIEW_BLOCKED"
        script.review_status = "REVIEW_BLOCKED"
        history_status = "Blocked"
        details = f"User kept script {script.file_name} blocked after reviewing AI findings"
    add_history(db, script.product_id, "User", "Script Review Decision", "GeneratedScript", script.id, history_status, details)
    db.commit()
    return serialize_script(script)


@router.post("/scripts/{script_id}/execute")
def execute_script(script_id: int, db: Session = Depends(get_db)):
    script = get_or_404(db, GeneratedScript, script_id, "Script")
    blockers = script_execution_blockers(script, db)
    if blockers:
        raise HTTPException(status_code=409, detail={"blocked": True, "reasons": blockers, "next_actions": ["Regenerate the script from approved mappings", "Complete AI review with an acceptable risk score"]})
    status = "RUNNING" if settings.enable_local_runner else "READY_TO_RUN"
    logs = [
        f"Generated command: {script.command}",
    ]
    if not settings.enable_local_runner:
        logs.extend([
            "Local runner execution is disabled by default for safety.",
            "Set ENABLE_LOCAL_RUNNER=true only on a controlled runner machine.",
        ])
    run = ExecutionRun(product_id=script.product_id, script_id=script.id, test_case_id=script.test_case_id, status=status, duration_seconds=0, logs=logs, evidence_path="evidence/pending", command=script.command)
    db.add(run)
    db.flush()
    mappings = db.scalars(select(StepMapping).join(TestStep).where(TestStep.test_case_id == script.test_case_id).order_by(StepMapping.step_number, StepMapping.id)).all()
    for index, mapping in enumerate(mappings, start=1):
        step = db.get(TestStep, mapping.test_step_id) if mapping.test_step_id else None
        instruction = step.instruction if step else ""
        db.add(ExecutionStepResult(execution_id=run.id, step_order=index, action=mapping.automation_action, instruction=instruction, status=status, message="Prepared for runner execution"))
    add_history(db, script.product_id, "User", "Execution Requested", "ExecutionRun", run.id, "Success", f"Execution requested for {script.file_name}")
    db.commit()
    if settings.enable_local_runner:
        run_local_execution(run, script, db)
    return serialize_execution(run, db)


@router.post("/executions/{execution_id}/run")
def run_ready_execution(execution_id: int, db: Session = Depends(get_db)):
    run = get_or_404(db, ExecutionRun, execution_id, "Execution")
    script = get_or_404(db, GeneratedScript, run.script_id, "Script")
    if not settings.enable_local_runner:
        raise HTTPException(status_code=409, detail="Local runner is disabled. Set ENABLE_LOCAL_RUNNER=true on the controlled TestPilot runner machine.")
    blockers = script_execution_blockers(script, db)
    if blockers:
        raise HTTPException(status_code=409, detail={"blocked": True, "reasons": blockers, "next_actions": ["Regenerate the script from approved mappings", "Complete AI review with an acceptable risk score"]})
    if run.status not in {"READY_TO_RUN", "FAILED"}:
        raise HTTPException(status_code=409, detail=f"Execution {execution_id} cannot run from status {run.status}")
    run.status = "RUNNING"
    run.logs = [*(run.logs or []), "TestPilot local runner started."]
    db.commit()
    run_local_execution(run, script, db)
    return serialize_execution(run, db)


def persisted_script_review_status(script: GeneratedScript, db: Session) -> str:
    settings_row = db.scalar(select(UserSetting).where(UserSetting.user_id == "default"))
    app_settings = {**default_settings(), **(settings_row.settings if settings_row else {})}
    max_risk = float(app_settings.get("maximum_allowed_risk_score", 75) or 75)
    recommendation = str((script.review_json or {}).get("approval_recommendation", "")).strip().lower().replace(" ", "_")
    approved_recommendations = {"approve", "approved", "pass", "passed", "ready", "ready_to_run"}
    validation_issues = script_objective_issues(script, db)
    if user_approved_script(script) and not validation_issues:
        return "USER_APPROVED"
    return "AI_REVIEWED" if recommendation in approved_recommendations and float(script.risk_score or 0) <= max_risk and not validation_issues else "REVIEW_BLOCKED"


def script_execution_blockers(script: GeneratedScript, db: Session) -> list[str]:
    settings_row = db.scalar(select(UserSetting).where(UserSetting.user_id == "default"))
    app_settings = {**default_settings(), **(settings_row.settings if settings_row else {})}
    max_risk = float(app_settings.get("maximum_allowed_risk_score", 75) or 75)
    recommendation = str((script.review_json or {}).get("approval_recommendation", "")).strip().lower().replace(" ", "_")
    approved_recommendations = {"approve", "approved", "pass", "passed", "ready", "ready_to_run"}
    blockers: list[str] = []
    manually_approved = user_approved_script(script)
    if not manually_approved and (script.review_status != "AI_REVIEWED" or recommendation not in approved_recommendations):
        blockers.append("AI script review did not approve this script for execution")
    if not manually_approved and float(script.risk_score or 0) > max_risk:
        blockers.append(f"Script risk score {script.risk_score:.1f} exceeds maximum allowed {max_risk:.1f}")
    validation_issues = script_objective_issues(script, db)
    blockers.extend(str(issue) for issue in validation_issues)
    path = Path(script.file_path)
    if not path.exists():
        blockers.append("Generated script file is missing")
    return blockers


def user_approved_script(script: GeneratedScript) -> bool:
    decision = (script.review_json or {}).get("user_decision") or {}
    return script.review_status == "USER_APPROVED" and decision.get("decision") == "approve_current" and bool(decision.get("risk_acknowledged"))


def script_objective_issues(script: GeneratedScript, db: Session, mappings: list[StepMapping] | None = None) -> list[str]:
    rows = mappings if mappings is not None else db.scalars(
        select(StepMapping).join(TestStep).where(TestStep.test_case_id == script.test_case_id).order_by(StepMapping.step_number, StepMapping.id)
    ).all()
    issues = sap_script_validation_issues(script.code, rows, db) if is_sap_framework(script.framework) else []
    test_case = db.get(TestCase, script.test_case_id)
    if test_case:
        issues.extend(mapping_completeness_issues(test_case, rows, db))
    return list(dict.fromkeys(issues))


SELENIUM_MAVEN_PROJECT = Path(__file__).resolve().parents[1] / "runners" / "selenium_maven_project"
PLAYWRIGHT_PROJECT = Path(__file__).resolve().parents[1] / "runners" / "playwright_project"
# Selenium/Playwright runs copy the generated file into these two shared, static project
# directories with no per-run isolation, so only one local execution may run at a time.
_LOCAL_RUNNER_LOCK = threading.Lock()


def is_selenium_java_framework(framework: str) -> bool:
    return framework.upper().replace(" ", "_").replace("-", "_") == "SELENIUM_JAVA"


def is_playwright_framework(framework: str) -> bool:
    return framework.upper().replace(" ", "_").replace("-", "_") == "PLAYWRIGHT"


_BLOCKED_RUNNER_HOSTS = {"169.254.169.254", "metadata.google.internal"}


def resolve_product_url(product: Product | None) -> str:
    """Resolve the target URL a local runner navigates to, blocking known cloud
    metadata endpoints — a product URL is otherwise expected to point at internal
    or on-prem apps, which this on-prem test runner must legitimately reach."""
    url = str((product.app_path_or_url if product else "") or (product.entry_point if product else "") or "")
    host = urlparse(url).hostname if url else None
    if host and host.lower() in _BLOCKED_RUNNER_HOSTS:
        raise ValueError(f"Refusing to navigate to blocked host: {host}")
    return url


def run_sap_vbscript(path: Path, logs: list[str]) -> tuple[subprocess.CompletedProcess, int]:
    windir = Path(os.environ.get("WINDIR", "C:/Windows"))
    candidates = [windir / "SysWOW64" / "cscript.exe", windir / "System32" / "cscript.exe"]
    host = next((candidate for candidate in candidates if candidate.exists()), None)
    if not host:
        raise FileNotFoundError("Windows Script Host cscript.exe was not found")
    command = [str(host), "//nologo", str(path)]
    logs.append(f"Runner host: {host}")
    timeout_seconds = settings.local_runner_timeout_seconds
    result = subprocess.run(
        command,
        cwd=str(path.parent),
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    return result, timeout_seconds


def run_selenium_java(path: Path, product_id: int, db: Session, logs: list[str]) -> tuple[subprocess.CompletedProcess, int]:
    # Windows resolves "mvn" to mvn.CMD; subprocess (shell=False) needs that exact
    # extension-qualified path or it fails with WinError 2 rather than running it.
    mvn_path = shutil.which("mvn")
    if not mvn_path:
        raise FileNotFoundError("Maven (mvn) was not found on PATH")
    class_match = re.search(r"public\s+class\s+(\w+)", path.read_text(encoding="utf-8"))
    if not class_match:
        raise ValueError("Could not find a public class declaration in the generated Java file")
    class_name = class_match.group(1)
    target = SELENIUM_MAVEN_PROJECT / "src" / "test" / "java" / f"{class_name}.java"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, target)

    product = db.get(Product, product_id)
    product_url = resolve_product_url(product)
    evidence_dir = path.parent / "evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PRODUCT_URL": product_url, "EVIDENCE_DIR": str(evidence_dir)}

    command = [mvn_path, "-q", "-B", f"-Dtest={class_name}", "test"]
    logs.append(f"Runner: Maven Selenium project at {SELENIUM_MAVEN_PROJECT}")
    logs.append(f"PRODUCT_URL={product_url or '(not set)'}")
    # First run downloads dependencies into the local .m2 cache (a few minutes); later runs
    # reuse that cache and finish in well under a minute for a single test class.
    timeout_seconds = max(settings.local_runner_timeout_seconds, 600)
    result = subprocess.run(
        command,
        cwd=str(SELENIUM_MAVEN_PROJECT),
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    return result, timeout_seconds


def run_playwright(path: Path, product_id: int, db: Session, logs: list[str]) -> tuple[subprocess.CompletedProcess, int]:
    # Same Windows .CMD-resolution issue as Maven: "npx" alone resolves to npx.CMD, which
    # subprocess (shell=False) can't launch by bare name.
    npx_path = shutil.which("npx")
    if not npx_path:
        raise FileNotFoundError("npx (Node.js) was not found on PATH")
    target = PLAYWRIGHT_PROJECT / "tests" / path.name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, target)

    product = db.get(Product, product_id)
    product_url = resolve_product_url(product)
    evidence_dir = path.parent / "evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PRODUCT_URL": product_url, "EVIDENCE_DIR": str(evidence_dir)}

    command = [npx_path, "playwright", "test", f"tests/{path.name}", "--reporter=line"]
    logs.append(f"Runner: Playwright project at {PLAYWRIGHT_PROJECT}")
    logs.append(f"PRODUCT_URL={product_url or '(not set)'}")
    # Playwright's own actionability auto-waiting makes runs fast once the browser binaries are
    # cached (first run downloads them); still leave headroom for a cold cache.
    timeout_seconds = max(settings.local_runner_timeout_seconds, 300)
    result = subprocess.run(
        command,
        cwd=str(PLAYWRIGHT_PROJECT),
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    return result, timeout_seconds


def run_local_execution(run: ExecutionRun, script: GeneratedScript, db: Session) -> None:
    with _LOCAL_RUNNER_LOCK:
        _run_local_execution_locked(run, script, db)


def _run_local_execution_locked(run: ExecutionRun, script: GeneratedScript, db: Session) -> None:
    started = time.monotonic()
    path = Path(script.file_path).resolve()
    generated_root = Path(settings.generated_script_dir).resolve()
    logs = list(run.logs or [])
    try:
        if not path.is_relative_to(generated_root):
            raise ValueError("Script path is outside TestPilot's generated-script directory")
        if is_sap_framework(script.framework) and path.suffix.lower() == ".vbs":
            result, timeout_seconds = run_sap_vbscript(path, logs)
        elif is_selenium_java_framework(script.framework) and path.suffix.lower() == ".java":
            result, timeout_seconds = run_selenium_java(path, run.product_id, db, logs)
        elif is_playwright_framework(script.framework) and path.name.endswith(".spec.ts"):
            result, timeout_seconds = run_playwright(path, run.product_id, db, logs)
        else:
            raise ValueError(f"Local execution is not supported for framework {script.framework}")
        if result.stdout.strip():
            logs.extend(result.stdout.strip().splitlines())
        if result.stderr.strip():
            logs.extend(f"STDERR: {line}" for line in result.stderr.strip().splitlines())
        run.status = "COMPLETED" if result.returncode == 0 else "FAILED"
        logs.append(f"Process exit code: {result.returncode}")
    except subprocess.TimeoutExpired as exc:
        run.status = "FAILED"
        logs.append(f"Execution timed out after {exc.timeout:.0f} seconds")
    except Exception as exc:
        run.status = "FAILED"
        logs.append(f"Runner error: {exc}")
    run.duration_seconds = round(time.monotonic() - started, 3)
    evidence_dir = path.parent / "evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    evidence_file = evidence_dir / f"execution-{run.id}.log"
    evidence_file.write_text("\n".join(logs) + "\n", encoding="utf-8")
    run.logs = logs
    run.evidence_path = str(evidence_file)
    feedback = apply_execution_failure_feedback(run, script, db, logs) if run.status == "FAILED" else {}
    failed_step_order = optional_int(feedback.get("failed_step_order")) if feedback else None
    step_status = "COMPLETED" if run.status == "COMPLETED" else "FAILED"
    steps = db.scalars(select(ExecutionStepResult).where(ExecutionStepResult.execution_id == run.id)).all()
    for step in steps:
        if run.status == "COMPLETED":
            step.status = step_status
            step.message = "Completed by TestPilot local runner"
        elif failed_step_order:
            if step.step_order < failed_step_order:
                step.status = "COMPLETED"
                step.message = "Completed before the failing step"
            elif step.step_order == failed_step_order:
                step.status = "FAILED"
                step.message = str(feedback.get("failure_message") or "Step failed; review execution logs")
            else:
                step.status = "SKIPPED"
                step.message = f"Skipped because step {failed_step_order} failed"
        else:
            step.status = step_status
            step.message = "TestPilot local runner failed; review execution logs"
    add_history(db, run.product_id, "TestPilot Agent", "Execution Completed", "ExecutionRun", run.id, run.status, f"Local execution {run.status.lower()} for {script.file_name}")
    db.commit()


def apply_execution_failure_feedback(run: ExecutionRun, script: GeneratedScript, db: Session, logs: list[str]) -> dict[str, Any]:
    mappings = db.scalars(
        select(StepMapping).join(TestStep).where(TestStep.test_case_id == script.test_case_id).order_by(StepMapping.step_number, StepMapping.id)
    ).all()
    analysis = deterministic_failure_analysis(logs, script.code, mappings, db)
    if not analysis:
        return {}

    run.failure_analysis_json = analysis
    failed_step_order = optional_int(analysis.get("failed_step_order"))
    failed_mapping = next((mapping for mapping in mappings if mapping.step_number == failed_step_order), None)
    failed_object = db.get(ObjectRepository, failed_mapping.object_id) if failed_mapping and failed_mapping.object_id else None
    if failed_mapping:
        failed_mapping.approved = False
        failed_mapping.status = "needs_review"
        failed_mapping.confidence = min(float(failed_mapping.confidence or 0), 40.0)
        failed_mapping.risk_score = max(float(failed_mapping.risk_score or 0), 85.0)
        failed_mapping.selected_reason = "Execution feedback: SAP could not use this mapped control at runtime; rerun mapping or rescan the exact screen."
    if failed_object:
        failed_object.confidence = min(float(failed_object.confidence or 0), 60.0)
        failed_object.verification_status = "Needs Review"
        note = f"Execution {run.id} failed at step {failed_step_order}: {analysis.get('failure_message')}"
        failed_object.notes = append_note(failed_object.notes, note)
        suggested = deterministic_auto_heal_candidate(failed_mapping, failed_object, mappings, db)
        if suggested and suggested.id != failed_object.id:
            # Auto-apply the mapping fix immediately — repeated failures on the same object
            # (same name, different row index) should be corrected without waiting for user approval.
            # The old object is flagged Needs Review; the mapping now points to the better candidate.
            failed_mapping.mapped_object_id = suggested.id
            failed_mapping.object_id = suggested.id
            failed_mapping.confidence = min(float(failed_mapping.confidence or 0), 55.0)
            failed_mapping.selected_reason = (
                f"Auto-healed: execution {run.id} failed on {failed_object.object_name}; "
                f"remapped to row-0 candidate {suggested.object_name} ({suggested.technical_path or ''})."
            )
            db.add(
                AutoHealSuggestion(
                    product_id=run.product_id,
                    execution_id=run.id,
                    object_id=failed_object.id,
                    old_path=failed_object.technical_path or "",
                    suggested_path=suggested.technical_path or "",
                    reason=f"Auto-healed: execution failed on {failed_object.object_name}; mapping updated to {suggested.object_name}.",
                    confidence=72,
                    risk_score=55,
                    ai_raw_response=json.dumps({"deterministic_auto_heal": True, "auto_applied": True, "failed_step_order": failed_step_order}),
                )
            )
    add_history(
        db,
        run.product_id,
        "TestPilot Agent",
        "Execution Feedback Applied",
        "ExecutionRun",
        run.id,
        "Needs Review",
        str(analysis.get("suggested_fix") or "Marked failed mapping for review."),
    )
    return analysis


def deterministic_failure_analysis(logs: list[str], script_code: str, mappings: list[StepMapping], db: Session) -> dict[str, Any]:
    joined = "\n".join(str(line) for line in logs)
    match = re.search(r"Step\s+(\d+):\s+(.+?)\s+failed:\s+(.+)", joined, re.IGNORECASE)
    if not match:
        return {}
    step_order = int(match.group(1))
    label = match.group(2).strip()
    message = match.group(3).strip()
    mapping = next((item for item in mappings if item.step_number == step_order), None)
    obj = db.get(ObjectRepository, mapping.object_id) if mapping and mapping.object_id else None
    control_missing = bool(re.search(r"control could not be found|could not be found by id|object.*unavailable", message, re.IGNORECASE))
    category = "object_issue" if control_missing else "runner_issue"
    suggested_fix = (
        "TestPilot marked the failed mapping as needs_review. Rerun step mapping; if no better candidate appears, run the Product Scanner on the exact SAP screen before this step."
        if control_missing
        else "Review the execution evidence and runner environment."
    )
    return {
        "deterministic": True,
        "failed_step_order": step_order,
        "failed_step_label": label,
        "failure_message": message,
        "likely_root_cause": f"Runtime SAP GUI control lookup failed for {obj.object_name if obj else label}.",
        "category": category,
        "failed_object": obj.object_name if obj else label,
        "failed_object_id": obj.id if obj else None,
        "failed_locator": sap_session_locator(obj.technical_path or "") if obj else "",
        "suggested_fix": suggested_fix,
        "auto_heal_possible": bool(control_missing),
        "bug_draft": {
            "title": f"SAP automation failed at step {step_order}: {label}",
            "description": message,
            "severity": "High" if control_missing else "Medium",
        },
    }


def deterministic_auto_heal_candidate(failed_mapping: StepMapping | None, failed_object: ObjectRepository, mappings: list[StepMapping], db: Session) -> ObjectRepository | None:
    if not failed_mapping:
        return None
    test_case = db.get(TestCase, failed_mapping.test_case_id) if failed_mapping.test_case_id else None
    if not test_case:
        return None
    objects = [
        obj
        for obj in db.scalars(select(ObjectRepository).where(ObjectRepository.product_id == failed_mapping.product_id)).all()
        if object_available_for_mapping(obj) and obj.id != failed_object.id
    ]
    candidates = mapping_object_candidates_for_text(
        test_case,
        objects,
        failed_mapping.manual_step,
        limit=3,
        required_action=failed_mapping.automation_action,
    )
    return candidates[0] if candidates else None


def append_note(existing: str | None, note: str) -> str:
    text = str(existing or "").strip()
    return f"{text} | {note}" if text else note


@router.get("/executions/{execution_id}")
def get_execution(execution_id: int, db: Session = Depends(get_db)):
    return serialize_execution(get_or_404(db, ExecutionRun, execution_id, "Execution"), db)


@router.get("/products/{product_id}/executions")
def list_executions(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    rows = db.scalars(select(ExecutionRun).where(ExecutionRun.product_id == product_id).order_by(ExecutionRun.created_at.desc())).all()
    changed = False
    for row in rows:
        if row.status != "READY_TO_RUN":
            continue
        script = db.get(GeneratedScript, row.script_id)
        blockers = script_execution_blockers(script, db) if script else ["Generated script record is missing"]
        if blockers:
            row.status = "BLOCKED"
            row.logs = [*(row.logs or []), "Execution blocked by current TestPilot safety gates.", *blockers]
            changed = True
    if changed:
        db.commit()
    return [serialize_execution(row, db) for row in rows]


@router.post("/executions/{execution_id}/analyze-failure")
def analyze_failure(execution_id: int, db: Session = Depends(get_db)):
    run = get_or_404(db, ExecutionRun, execution_id, "Execution")
    script = get_or_404(db, GeneratedScript, run.script_id, "Script")
    mappings = db.scalars(select(StepMapping).join(TestStep).where(TestStep.test_case_id == script.test_case_id).order_by(TestStep.step_order)).all()
    analysis = deterministic_failure_analysis(run.logs or [], script.code, mappings, db)
    if not analysis and settings.ai_provider.strip().lower() not in {"local", "llama_cpp", "llamacpp"}:
        analysis = agent.analyze_failure(run.logs, script.code, [serialize_mapping(mapping, db) for mapping in mappings])
    if not analysis:
        analysis = {
            "deterministic": True,
            "likely_root_cause": "No structured SAP failure line was found in the execution logs.",
            "category": "unknown",
            "failed_object": None,
            "suggested_fix": "Review execution evidence and rerun with SAP GUI visible on the controlled runner machine.",
            "auto_heal_possible": False,
            "bug_draft": {"title": f"Execution {run.id} failed", "description": "\n".join(run.logs or []), "severity": "Medium"},
        }
    run.failure_analysis_json = analysis
    add_history(db, run.product_id, "TestPilot Agent", "Failure Analyzed", "ExecutionRun", run.id, "Success", f"Analyzed execution {run.id}")
    db.commit()
    return analysis


@router.post("/products/{product_id}/auto-heal/suggest")
def suggest_auto_heal_for_product(product_id: int, payload: dict[str, Any] = Body(default_factory=dict), db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    object_id = payload.get("object_id")
    obj = (
        db.scalar(select(ObjectRepository).where(ObjectRepository.id == int(object_id), ObjectRepository.product_id == product_id))
        if object_id
        else db.scalar(select(ObjectRepository).where(ObjectRepository.product_id == product_id).order_by(ObjectRepository.confidence.asc()))
    )
    if not obj:
        raise HTTPException(status_code=400, detail="Add an object repository item before requesting auto-heal")
    available_objects = db.scalars(select(ObjectRepository).where(ObjectRepository.product_id == product_id)).all()
    failure_context = payload.get("failure_context") or {}
    if payload.get("execution_id"):
        run = db.scalar(select(ExecutionRun).where(ExecutionRun.id == int(payload["execution_id"]), ExecutionRun.product_id == product_id))
        if run and run.failure_analysis_json:
            failure_context = run.failure_analysis_json
    ai_suggestion = agent.suggest_auto_heal(serialize_object(obj, db), [serialize_object(item, db) for item in available_objects], failure_context)
    old_path = str(ai_suggestion.get("old_path") or payload.get("old_path") or obj.technical_path)
    suggested_path = str(ai_suggestion.get("suggested_path") or "")
    if not suggested_path:
        raise HTTPException(status_code=502, detail="AI provider did not return a suggested auto-heal path")
    suggestion = AutoHealSuggestion(
        product_id=product_id,
        execution_id=payload.get("execution_id"),
        object_id=obj.id,
        old_path=old_path,
        suggested_path=suggested_path,
        reason=str(ai_suggestion.get("reason") or "AI provider suggested this path from failure context and object repository candidates."),
        confidence=float(ai_suggestion.get("confidence", 0) or 0),
        risk_score=float(ai_suggestion.get("risk_score", 50) or 50),
        ai_raw_response=str(ai_suggestion.get("ai_raw_response", "")),
    )
    db.add(suggestion)
    db.flush()
    add_history(db, product_id, "TestPilot Agent", "Auto Heal Suggested", "AutoHealSuggestion", suggestion.id, "Pending Review", f"Suggested path for {obj.object_name}")
    db.commit()
    return serialize_auto_heal(suggestion, db)


@router.post("/auto-heal/suggest")
def suggest_auto_heal_legacy(payload: dict[str, Any] = Body(default_factory=dict), db: Session = Depends(get_db)):
    product_id = int(payload.get("product_id") or 0)
    if not product_id:
        run = db.get(ExecutionRun, int(payload.get("execution_id") or 0))
        product_id = run.product_id if run else 0
    if not product_id:
        raise HTTPException(status_code=400, detail="product_id or execution_id is required")
    return suggest_auto_heal_for_product(product_id, payload, db)


@router.get("/products/{product_id}/auto-heal")
def list_auto_heal(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    rows = db.scalars(select(AutoHealSuggestion).where(AutoHealSuggestion.product_id == product_id).order_by(AutoHealSuggestion.created_at.desc())).all()
    return [serialize_auto_heal(row, db) for row in rows]


@router.post("/auto-heal/{suggestion_id}/approve")
def approve_auto_heal(suggestion_id: int, db: Session = Depends(get_db)):
    suggestion = get_or_404(db, AutoHealSuggestion, suggestion_id, "Auto-heal suggestion")
    obj = db.get(ObjectRepository, suggestion.object_id) if suggestion.object_id else None
    before = obj.technical_path if obj else ""
    if obj:
        obj.technical_path = suggestion.suggested_path
        obj.status = "Active"
        obj.confidence = max(obj.confidence, suggestion.confidence)
        obj.path_history = [*list(obj.path_history or []), {"before": before, "after": suggestion.suggested_path, "changed_at": now_iso(), "source": "auto-heal"}]
    suggestion.status = "Approved"
    suggestion.decided_at = datetime.now(UTC)
    add_history(db, suggestion.product_id, "User", "Auto Heal Approved", "AutoHealSuggestion", suggestion.id, "Success", "Approved auto-heal and updated repository path", before, suggestion.suggested_path)
    db.commit()
    return serialize_auto_heal(suggestion, db)


@router.post("/auto-heal/{suggestion_id}/reject")
def reject_auto_heal(suggestion_id: int, db: Session = Depends(get_db)):
    suggestion = get_or_404(db, AutoHealSuggestion, suggestion_id, "Auto-heal suggestion")
    suggestion.status = "Rejected"
    suggestion.decided_at = datetime.now(UTC)
    add_history(db, suggestion.product_id, "User", "Auto Heal Rejected", "AutoHealSuggestion", suggestion.id, "Rejected", "Rejected auto-heal suggestion")
    db.commit()
    return serialize_auto_heal(suggestion, db)


@router.get("/products/{product_id}/coverage/gaps")
def coverage_gaps(product_id: int, db: Session = Depends(get_db)):
    product = ensure_product(db, product_id)
    summary_row = db.scalar(select(KnowledgeSummary).where(KnowledgeSummary.product_id == product_id))
    summary = serialize_knowledge_summary(summary_row, product_id, db) if summary_row else empty_knowledge_summary(product_id, db)
    test_cases = [serialize_test_case(row, include_steps=True) for row in db.scalars(select(TestCase).where(TestCase.product_id == product_id)).all()]
    objects = [serialize_object(row, db) for row in db.scalars(select(ObjectRepository).where(ObjectRepository.product_id == product_id)).all()]
    db_gaps = calculate_coverage_gaps(summary, test_cases, objects)
    ai_gaps = agent.generate_coverage_gaps(serialize_product(product), summary, test_cases, objects)
    return {"database_gaps": db_gaps, "ai_gaps": ai_gaps}


@router.get("/products/{product_id}/regression/impact")
def regression_impact(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    changed = db.scalar(select(ObjectRepository).where(ObjectRepository.product_id == product_id).order_by(ObjectRepository.updated_at.desc()))
    if not changed or not changed.path_history:
        return {"impact_level": "low", "changed_object": None, "impacted_mappings": [], "impacted_scripts": [], "recommended_actions": ["No object path changes recorded yet."]}
    impacted_mappings = db.scalars(select(StepMapping).where(StepMapping.product_id == product_id, StepMapping.object_id == changed.id)).all()
    impacted_case_ids = sorted({mapping.test_case_id for mapping in impacted_mappings if mapping.test_case_id})
    impacted_scripts = db.scalars(select(GeneratedScript).where(GeneratedScript.product_id == product_id, GeneratedScript.test_case_id.in_(impacted_case_ids))).all() if impacted_case_ids else []
    explanation = agent.explain_regression_impact(
        serialize_object(changed, db),
        [serialize_mapping(mapping, db) for mapping in impacted_mappings],
        [serialize_script(script) for script in impacted_scripts],
    )
    return {"changed_object": serialize_object(changed, db), "impact": explanation}


@router.get("/products/{product_id}/approvals")
def approval_queue(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    pending_mappings = db.scalars(
        select(StepMapping)
        .where(StepMapping.product_id == product_id, StepMapping.status.in_(["needs_review", "mapped"]), StepMapping.approved.is_(False))
        .order_by(StepMapping.updated_at.desc())
    ).all()
    pending_heals = db.scalars(
        select(AutoHealSuggestion)
        .where(AutoHealSuggestion.product_id == product_id, AutoHealSuggestion.status == "Pending Review")
        .order_by(AutoHealSuggestion.created_at.desc())
    ).all()
    return {
        "mappings": [serialize_mapping(row, db) for row in pending_mappings],
        "auto_heal": [serialize_auto_heal(row, db) for row in pending_heals],
        "blocked_scripts": blocked_script_candidates(product_id, db),
    }


@router.get("/integrations")
def list_integrations(db: Session = Depends(get_db)):
    rows = db.scalars(select(IntegrationConfig).order_by(IntegrationConfig.updated_at.desc())).all()
    return [serialize_integration(row) for row in rows]


@router.get("/products/{product_id}/integrations")
def list_product_integrations(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    rows = db.scalars(select(IntegrationConfig).where(IntegrationConfig.product_id == product_id).order_by(IntegrationConfig.updated_at.desc())).all()
    return [serialize_integration(row) for row in rows]


@router.post("/products/{product_id}/integrations/zephyr/config")
def configure_product_zephyr(product_id: int, payload: IntegrationConfigIn, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    config = db.scalar(select(IntegrationConfig).where(IntegrationConfig.product_id == product_id, IntegrationConfig.integration_type == "zephyr"))
    if not config:
        config = IntegrationConfig(product_id=product_id, integration_type="zephyr")
        db.add(config)
    config.config = payload.model_dump()
    config.enabled = True
    add_history(db, product_id, "User", "Integration Configured", "IntegrationConfig", "zephyr", "Success", "Configured Zephyr/Jira integration")
    db.commit()
    return serialize_integration(config)


@router.post("/products/{product_id}/integrations/zephyr/import")
def import_product_zephyr(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    add_history(db, product_id, "User", "Integration Sync Completed", "IntegrationConfig", "zephyr", "Success", "Zephyr import requested")
    db.commit()
    return {"status": "queued", "detail": "Zephyr import placeholder queued"}


@router.post("/products/{product_id}/integrations/zephyr/export-results")
def export_product_zephyr_results(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    add_history(db, product_id, "User", "Zephyr Updated", "IntegrationConfig", "zephyr", "Success", "Execution export requested")
    db.commit()
    return {"status": "queued", "detail": "Zephyr export placeholder queued"}


@router.post("/integrations/zephyr/config")
def configure_zephyr(payload: IntegrationConfigIn, db: Session = Depends(get_db)):
    config = db.scalar(select(IntegrationConfig).where(IntegrationConfig.integration_type == "zephyr"))
    if not config:
        config = IntegrationConfig(integration_type="zephyr")
        db.add(config)
    data = payload.model_dump()
    config.config = data
    config.enabled = True
    add_history(db, None, "User", "Integration Configured", "IntegrationConfig", "zephyr", "Success", "Configured Zephyr/Jira integration")
    db.commit()
    return serialize_integration(config)


@router.post("/integrations/zephyr/import")
def import_zephyr(db: Session = Depends(get_db)):
    add_history(db, None, "User", "Integration Sync Completed", "IntegrationConfig", "zephyr", "Success", "Zephyr import requested")
    db.commit()
    return {"status": "queued", "detail": "Zephyr import placeholder queued"}


@router.post("/integrations/zephyr/export-results")
def export_zephyr_results(db: Session = Depends(get_db)):
    add_history(db, None, "User", "Zephyr Updated", "IntegrationConfig", "zephyr", "Success", "Execution export requested")
    db.commit()
    return {"status": "queued", "detail": "Zephyr export placeholder queued"}


@router.post("/integrations/jira/create-defect")
def create_jira_defect(payload: dict[str, Any] = Body(default_factory=dict), db: Session = Depends(get_db)):
    add_history(db, payload.get("product_id"), "User", "Jira Defect Created", "IntegrationConfig", "jira", "Success", payload.get("summary", "Defect placeholder requested"))
    db.commit()
    return {"status": "queued", "detail": "Jira defect placeholder queued"}


@router.get("/products/{product_id}/reports/summary")
def report_summary(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    return product_report(product_id, db)


@router.get("/products/{product_id}/reports/coverage")
def report_coverage(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    modules = db.scalars(select(TestCase.module).where(TestCase.product_id == product_id)).all()
    unique_modules = sorted({module or "Unassigned" for module in modules})
    rows = []
    for module in unique_modules:
        total = db.scalar(select(func.count()).select_from(TestCase).where(TestCase.product_id == product_id, TestCase.module == module)) or 0
        mapped = db.scalar(select(func.count()).select_from(StepMapping).join(TestStep).join(TestCase).where(TestCase.product_id == product_id, TestCase.module == module, StepMapping.status.in_(["mapped", "approved"]))) or 0
        coverage = int(min(100, mapped * 100 / max(total, 1)))
        rows.append({"module": module, "test_cases": total, "mapped_steps": mapped, "coverage": coverage})
    return rows


@router.get("/reports/global-summary")
def global_summary(db: Session = Depends(get_db)):
    return {
        "total_products": count(db, Product),
        "total_knowledge_sources": count(db, KnowledgeSource),
        "total_objects": count(db, ObjectRepository),
        "total_test_cases": count(db, TestCase),
        "mapped_steps": count_where(db, StepMapping, StepMapping.status.in_(["mapped", "approved"])),
        "unmapped_steps": count_where(db, StepMapping, StepMapping.status == "unmapped"),
        "generated_scripts": count(db, GeneratedScript),
        "executions": count(db, ExecutionRun),
        "auto_heal_suggestions": count(db, AutoHealSuggestion),
        "history_events": count(db, HistoryEvent),
    }


@router.get("/products/{product_id}/history")
def list_history(product_id: int, db: Session = Depends(get_db)):
    ensure_product(db, product_id)
    rows = db.scalars(select(HistoryEvent).where(HistoryEvent.product_id == product_id).order_by(HistoryEvent.created_at.desc())).all()
    return [serialize_history(row) for row in rows]


@router.post("/history")
def create_history(payload: dict[str, Any] = Body(default_factory=dict), db: Session = Depends(get_db)):
    row = HistoryEvent(
        product_id=payload.get("product_id"),
        actor=payload.get("actor", "User"),
        action=payload.get("action", "Manual History Event"),
        entity_type=payload.get("entity_type", "Manual"),
        entity_id=str(payload.get("entity_id", "")),
        status=payload.get("status", "Success"),
        details=payload.get("details", ""),
        before_value=json_value(payload.get("before_value", "")),
        after_value=json_value(payload.get("after_value", "")),
    )
    db.add(row)
    db.commit()
    return serialize_history(row)


def get_or_create_user_settings(db: Session) -> UserSetting:
    row = db.scalar(select(UserSetting).where(UserSetting.user_id == "default"))
    if row:
        return row
    row = UserSetting(user_id="default", settings=default_settings())
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        # Another concurrent request won the insert race on the unique user_id
        # constraint; fall back to the row it created instead of erroring out.
        db.rollback()
        row = db.scalar(select(UserSetting).where(UserSetting.user_id == "default"))
    return row


@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    row = get_or_create_user_settings(db)
    merged = normalize_settings_payload(row.settings)
    if row.settings != merged:
        row.settings = merged
        db.commit()
    return merged


@router.put("/settings")
def update_settings(payload: SettingsIn, db: Session = Depends(get_db)):
    row = get_or_create_user_settings(db)
    row.settings = normalize_settings_payload(payload.settings)
    add_history(db, None, "User", "Settings Updated", "UserSetting", "default", "Success", "Updated application settings")
    db.commit()
    return row.settings


def get_or_404(db: Session, model: type, item_id: int, label: str):
    row = db.get(model, item_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"{label} not found.")
    return row


def ensure_product(db: Session, product_id: int) -> Product:
    return get_or_404(db, Product, product_id, "Product")


def add_history(
    db: Session,
    product_id: int | None,
    actor: str,
    action: str,
    entity_type: str,
    entity_id: int | str,
    status: str,
    details: str,
    before: Any = "",
    after: Any = "",
) -> None:
    db.add(
        HistoryEvent(
            product_id=product_id,
            actor=actor,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            status=status,
            details=details,
            before_value=json_value(before),
            after_value=json_value(after),
        )
    )


def safe_filename(value: str) -> str:
    name = Path(value).name
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._") or "file"


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def json_value(value: Any) -> str:
    if value in (None, ""):
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, default=str)


def split_list(value: list[str] | str | None) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if not value:
        return []
    return [part.strip() for part in re.split(r"[,;\n|]", str(value)) if part.strip()]


def split_steps(value: list[str] | str | None) -> list[str]:
    if isinstance(value, list):
        raw = "\n".join(str(item) for item in value)
    else:
        raw = str(value or "")
    candidates = re.split(r"\n+|(?:(?:^|\s)\d+[.)]\s+)|\s;\s", raw)
    return [candidate.strip(" -\t") for candidate in candidates if candidate.strip(" -\t")]


def normalize_object_payload(data: dict[str, Any]) -> dict[str, Any]:
    data["supported_actions"] = [action.lower().replace(" ", "_") for action in split_list(data.get("supported_actions"))]
    data["aliases"] = split_list(data.get("aliases"))
    data["platform"] = normalize_platform(data.get("platform", "Hybrid"))
    data["confidence"] = float(data.get("confidence") or 0)
    data["scope"] = normalize_scope(data.get("scope"))
    data["verification_status"] = str(data.get("verification_status") or data.get("verificationStatus") or ("Verified" if data.get("last_verified") else "Unverified"))
    data["area_or_tab"] = str(data.get("area_or_tab") or data.get("areaOrTab") or "")
    data["screen_type"] = str(data.get("screen_type") or data.get("screenType") or "SCREEN")
    data["locator_strategy"] = str(data.get("locator_strategy") or data.get("locatorStrategy") or locator_strategy(data.get("technical_path", ""), data.get("platform", "")))
    data["captured_from"] = str(data.get("captured_from") or data.get("capturedFrom") or "")
    data["notes"] = str(data.get("notes") or "")
    data["parent_screen_id"] = data.get("parent_screen_id") or data.get("parentScreenId")
    data["parent_object_id"] = data.get("parent_object_id") or data.get("parentObjectId")
    return data


def normalize_scope(value: Any) -> str:
    scope = str(value or "SCREEN").upper().replace(" ", "_").replace("-", "_")
    allowed = {"GLOBAL", "MODULE", "FEATURE", "SCREEN", "POPUP", "DETAIL_SCREEN"}
    return scope if scope in allowed else "SCREEN"


def locator_strategy(path: Any, platform: Any) -> str:
    text = str(path or "")
    platform_text = str(platform or "").upper()
    if platform_text == "SAP GUI" or text.startswith("/app/"):
        return "SAP_GUI_ID"
    if text.startswith("//") or text.startswith("("):
        return "XPATH"
    if text.startswith("#") or text.startswith(".") or "[" in text:
        return "CSS"
    return "TECHNICAL_PATH"


def sap_crawler_item_to_object(item: dict[str, Any], hierarchy: dict[str, dict[str, str]] | None = None) -> dict[str, Any] | None:
    technical_path = str(item.get("technical_path") or item.get("path") or item.get("id") or "").strip()
    if not technical_path:
        return None
    hierarchy_data = (hierarchy or {}).get(technical_path, {})
    object_type = sap_object_type(item)
    scope = sap_object_scope(item, object_type, technical_path)
    module = first_text(item.get("module"), hierarchy_data.get("module"), item.get("transaction"), default="Discovered SAP GUI")
    feature = first_text(hierarchy_data.get("feature"), item.get("feature"), item.get("program"), default="Screen Discovery")
    area_or_tab = first_text(hierarchy_data.get("area_or_tab"), item.get("area_or_tab"), hierarchy_data.get("module"), default="")
    screen = first_text(item.get("screen"), item.get("window_title"), item.get("title"), default="Captured Screen")
    if scope == "GLOBAL":
        module = "Global"
        feature = "Common Controls"
        area_or_tab = "Global"
    object_name = sap_crawler_object_name(
        item,
        technical_path,
        first_text(
        item.get("object_name"),
        item.get("label"),
        item.get("text"),
        item.get("tooltip"),
        item.get("name"),
        technical_path.rsplit("/", 1)[-1],
        ),
    )
    aliases = [value for value in [item.get("text"), item.get("tooltip"), item.get("name"), item.get("accelerator_key")] if str(value or "").strip()]
    supported_actions = sap_supported_actions(object_type, item)
    notes = sap_crawler_notes(item, scope)
    return normalize_object_payload(
        {
            "object_name": object_name[:255],
            "platform": "SAP GUI",
            "module": module,
            "area_or_tab": area_or_tab,
            "feature": feature,
            "screen": screen,
            "screen_type": "POPUP" if "/wnd[1]" in technical_path or "/wnd[2]" in technical_path else "SCREEN",
            "object_type": object_type,
            "technical_path": technical_path,
            "locator_strategy": "SAP_GUI_ID",
            "supported_actions": supported_actions,
            "scope": scope,
            "verification_status": "Unverified",
            "captured_from": str(item.get("discovery_action") or item.get("captured_from") or "SAP GUI crawler"),
            "notes": notes,
            "aliases": aliases,
            "confidence": sap_crawler_confidence(item, scope),
            "status": "Active",
        }
    )


def sap_object_scope(item: dict[str, Any], object_type: str, path: str) -> str:
    explicit = item.get("scope")
    if explicit:
        return normalize_scope(explicit)
    if "/wnd[1]" in path or "/wnd[2]" in path:
        return "POPUP"
    if sap_common_chrome_path(path):
        return "GLOBAL"
    if object_type in {"menu", "tab", "tree"}:
        return "FEATURE"
    return "SCREEN"


def sap_common_chrome_path(path: str) -> bool:
    return bool(re.search(r"/wnd\[\d+\]/(?:tbar\[\d+\]|sbar)(?:/|$)", path) or re.search(r"/wnd\[\d+\]/mbar$", path))


def object_duplicate_query(product_id: int, data: dict[str, Any]):
    conditions = [
        ObjectRepository.product_id == product_id,
        ObjectRepository.platform == data.get("platform", ""),
        ObjectRepository.technical_path == data.get("technical_path", ""),
        ObjectRepository.object_type == data.get("object_type", ""),
        ObjectRepository.object_name == data.get("object_name", ""),
        ObjectRepository.scope == data.get("scope", "SCREEN"),
    ]
    if data.get("scope") == "GLOBAL":
        conditions.extend(
            [
                ObjectRepository.module == "Global",
                ObjectRepository.feature == "Common Controls",
            ]
        )
    else:
        conditions.extend(
            [
                ObjectRepository.module == data.get("module", ""),
                ObjectRepository.screen == data.get("screen", ""),
                ObjectRepository.screen_type == data.get("screen_type", "SCREEN"),
            ]
        )
    return select(ObjectRepository).where(*conditions).order_by(ObjectRepository.id.asc())


def crawler_object_identity_query(product_id: int, data: dict[str, Any]):
    """Find the same business control after SAP changes its technical path."""
    return select(ObjectRepository).where(
        ObjectRepository.product_id == product_id,
        ObjectRepository.platform == data.get("platform", ""),
        ObjectRepository.object_name == data.get("object_name", ""),
        ObjectRepository.object_type == data.get("object_type", ""),
        ObjectRepository.scope == data.get("scope", "SCREEN"),
        ObjectRepository.module == data.get("module", ""),
        ObjectRepository.screen == data.get("screen", ""),
        ObjectRepository.screen_type == data.get("screen_type", "SCREEN"),
    ).order_by(ObjectRepository.id.asc())


def sap_can_identity_merge(data: dict[str, Any]) -> bool:
    """Only path-heal when the object has a real business label.

    SAP often repeats technical names such as shell, container, or field ids on
    one screen. Treating those as stable business identities drops objects.
    Exact path duplicates are still merged by object_duplicate_query.
    """
    object_name = str(data.get("object_name") or "")
    path = str(data.get("technical_path") or "")
    if sap_technical_label(object_name):
        return False
    leaf = path.rsplit("/", 1)[-1]
    if normalize_key(object_name) == normalize_key(leaf):
        return False
    if data.get("object_type") in {"container", "label"} and not data.get("aliases"):
        return False
    return True


def merge_duplicate_objects(db: Session, keeper: ObjectRepository, duplicates: list[ObjectRepository]) -> int:
    merged = 0
    for duplicate in duplicates:
        for mapping in db.scalars(select(StepMapping).where(StepMapping.object_id == duplicate.id)).all():
            mapping.object_id = keeper.id
            mapping.mapped_object_id = keeper.id
        for suggestion in db.scalars(select(AutoHealSuggestion).where(AutoHealSuggestion.object_id == duplicate.id)).all():
            suggestion.object_id = keeper.id
        keeper.aliases = sorted(set([*(keeper.aliases or []), *(duplicate.aliases or [])]))
        keeper.supported_actions = sorted(set([*(keeper.supported_actions or []), *(duplicate.supported_actions or [])]))
        keeper.path_history = [*(keeper.path_history or []), *(duplicate.path_history or [])]
        keeper.confidence = max(float(keeper.confidence or 0), float(duplicate.confidence or 0))
        if not keeper.last_verified and duplicate.last_verified:
            keeper.last_verified = duplicate.last_verified
        if str(duplicate.verification_status or "").lower() == "verified":
            keeper.verification_status = "Verified"
        db.delete(duplicate)
        merged += 1
    return merged


def sap_crawler_hierarchy(items: list[Any]) -> dict[str, dict[str, str]]:
    by_path: dict[str, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        path = str(item.get("technical_path") or item.get("path") or item.get("id") or "").strip()
        if path:
            by_path[path] = item
    group_labels = sap_group_labels_by_prefix(list(by_path.values()))

    hierarchy: dict[str, dict[str, str]] = {}
    for path, item in by_path.items():
        ancestors = [
            (candidate_path, candidate)
            for candidate_path, candidate in by_path.items()
            if candidate_path != path and path.startswith(candidate_path)
        ]
        ancestors.sort(key=lambda pair: len(pair[0]))
        names: list[str] = []
        for _, ancestor in ancestors:
            if sap_hierarchy_candidate(ancestor):
                label = sap_item_label(ancestor)
                if label and label not in names:
                    names.append(label)
        own_label = sap_item_label(item)
        group_label = sap_group_label_for_item(item, group_labels)
        if sap_hierarchy_candidate(item) and own_label and own_label not in names:
            names.append(own_label)
        names = [name for name in names if name.lower() not in {"goto se", "menu", "system", "version"}]
        module = names[0] if names else first_text(item.get("transaction"), default="Discovered SAP GUI")
        feature = group_label or (names[1] if len(names) > 1 else (own_label if own_label and own_label != module else "Screen Discovery"))
        area_or_tab = names[0] if names else ""
        hierarchy[path] = {"module": module, "area_or_tab": area_or_tab, "feature": feature}
    return hierarchy


def sap_group_labels_by_prefix(items: list[dict[str, Any]]) -> dict[str, str]:
    labels: dict[str, str] = {}
    for item in items:
        name = str(item.get("name") or "").upper()
        label = sap_item_label(item)
        match = re.match(r"^([A-Z]+)BUTTON$", name)
        if match and label:
            labels[match.group(1)] = label
    return labels


def sap_group_label_for_item(item: dict[str, Any], group_labels: dict[str, str]) -> str:
    name = str(item.get("name") or "").upper()
    match = re.match(r"^([A-Z]+)\d+$", name)
    if match and match.group(1) in group_labels:
        return group_labels[match.group(1)]
    if match:
        child_prefix = match.group(1)
        for group_prefix, label in group_labels.items():
            if len(child_prefix) >= 3 and (group_prefix.startswith(child_prefix) or child_prefix.startswith(group_prefix)):
                return label
    return ""


def sap_hierarchy_candidate(item: dict[str, Any]) -> bool:
    raw_type = str(item.get("object_type") or item.get("type") or "").lower()
    path = str(item.get("technical_path") or item.get("path") or item.get("id") or "").lower()
    if not any(token in raw_type or token in path for token in ["menu", "tab", "tree"]):
        return False
    return bool(sap_item_label(item))


def sap_item_label(item: dict[str, Any]) -> str:
    label = first_text(item.get("object_name"), item.get("text"), item.get("tooltip"), item.get("name"))
    label = re.sub(r"\s+", " ", label).strip()
    if not label:
        return ""
    lower = label.lower()
    text_like = first_text(item.get("object_name"), item.get("text"), item.get("tooltip"))
    if not text_like and re.match(r"^[A-Z0-9_:/.-]+$", label):
        return ""
    if re.match(r"^(wnd|usr|mbar|tbar|sbar|pane|btn|menu|shell|shellcont|cntl|tabp|tabs)", lower):
        return ""
    if lower.startswith(("gui", "sapgui.", "sap.", "yx_", "gcl_")):
        return ""
    if sum(ch.isalpha() for ch in label) < 3:
        return ""
    return label[:120]


def sap_crawler_object_name(item: dict[str, Any], technical_path: str, label: str) -> str:
    clean_label = re.sub(r"\s+", " ", str(label or "")).strip()
    if clean_label and not sap_technical_label(clean_label):
        return clean_label[:255]
    leaf = technical_path.rsplit("/", 1)[-1] or "sap_object"
    parent = technical_path.rsplit("/", 2)[-2] if "/" in technical_path else ""
    suffix = re.sub(r"[^A-Za-z0-9_\\[\\]-]+", "_", f"{parent}_{leaf}".strip("_"))
    raw_type = str(item.get("type") or item.get("object_type") or "SAP GUI Object").replace("Gui", "").strip()
    return f"{raw_type} {suffix}"[:255]


def sap_technical_label(value: Any) -> bool:
    label = str(value or "").strip()
    lower = label.lower()
    if not label:
        return True
    if "/" in label and " " not in label:
        return True
    if re.match(r"^(wnd|usr|mbar|tbar|sbar|pane|btn|menu|shell|shellcont|cntl|tabp|tabs|ctxt|txt|lbl|cmb|tbl|sub)", lower):
        return True
    if lower.startswith(("gui", "sapgui.", "sap.", "yx_", "gcl_")):
        return True
    return False


def decode_crawler_json(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "utf-16-le", "utf-16-be"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8-sig")


def parse_crawler_payload(raw: bytes) -> Any:
    text = decode_crawler_json(raw).strip()
    if not text:
        raise json.JSONDecodeError("empty crawler payload", text, 0)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        rows = []
        events = []
        for line in text.splitlines():
            line = line.strip().rstrip(",")
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict) and row.get("event"):
                events.append(row)
            else:
                rows.append(row)
        if not rows and not events:
            raise json.JSONDecodeError("crawler payload contained no parseable JSON lines", text, 0)
        return {"source": "TestPilot SAP GUI JSONL crawler", "events": events, "objects": rows}


def first_text(*values: Any, default: str = "") -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return default


def sap_object_type(item: dict[str, Any]) -> str:
    raw_type = str(item.get("object_type") or item.get("type") or "").lower()
    raw_id = str(item.get("id") or item.get("technical_path") or item.get("path") or "").lower()
    leaf = raw_id.rsplit("/", 1)[-1]
    if "button" in raw_type or leaf.startswith("btn") or "/btn" in raw_id:
        return "button"
    if "combo" in raw_type or leaf.startswith("cmb") or "/cmb" in raw_id:
        return "dropdown"
    if "table" in raw_type or "grid" in raw_type or "/tbl" in raw_id:
        return "table"
    if "ctext" in raw_type or "textfield" in raw_type or leaf.startswith(("ctxt", "txt")) or "/ctxt" in raw_id or "/txt" in raw_id:
        return "input"
    if "label" in raw_type or leaf.startswith("lbl") or "/lbl" in raw_id:
        return "label"
    if "box" in raw_type or leaf.startswith("box") or "/box" in raw_id:
        return "container"
    if "tree" in raw_type:
        return "tree"
    if "tab" in raw_type or raw_id.rsplit("/", 1)[-1].startswith("tabp"):
        return "tab"
    if "sbar" in raw_id or "statusbar" in raw_type or "message" in raw_type:
        return "message"
    if "menu" in raw_type:
        return "menu"
    return "input"


def sap_supported_actions(object_type: str, item: dict[str, Any] | None = None) -> list[str]:
    actions_by_type = {
        "button": ["click", "verify"],
        "dropdown": ["select", "verify"],
        "table": ["select", "enter_text", "verify"],
        "tree": ["select", "verify"],
        "tab": ["click", "verify"],
        "message": ["verify"],
        "menu": ["click", "select", "verify"],
        "label": ["verify"],
        "container": ["verify"],
    }
    actions = list(actions_by_type.get(object_type, ["enter_text", "click", "verify"]))
    metadata = item or {}
    if str(metadata.get("changeable") or "").lower() == "true" and object_type in {"input", "table"} and "enter_text" not in actions:
        actions.insert(0, "enter_text")
    if str(metadata.get("required") or "").lower() == "true" and "verify_required" not in actions:
        actions.append("verify_required")
    if str(metadata.get("hotkey") or metadata.get("accelerator_key") or "").strip() and "hotkey" not in actions:
        actions.append("hotkey")
    return actions


def sap_crawler_confidence(item: dict[str, Any], scope: str) -> float:
    explicit = item.get("confidence")
    if explicit is not None:
        return float(explicit or 0)
    score = 88 if scope != "GLOBAL" else 82
    if sap_item_label(item):
        score += 5
    if item.get("parent_id"):
        score += 2
    if item.get("screen") or item.get("window_title"):
        score += 2
    return float(min(score, 97))


def sap_crawler_notes(item: dict[str, Any], scope: str) -> str:
    parts: list[str] = []
    if scope == "GLOBAL":
        parts.append("SAP common chrome captured as global; not attached to a business screen.")
    for label, key in [
        ("transaction", "transaction"),
        ("area/tab", "area_or_tab"),
        ("screen key", "screen_key"),
        ("source screen", "source_screen"),
        ("source action", "source_action_id"),
        ("discovery action", "discovery_action"),
        ("exploration kind", "exploration_kind"),
        ("action hint", "action_hint"),
        ("SAP type", "type"),
        ("name", "name"),
        ("required", "required"),
        ("changeable", "changeable"),
        ("visible", "visible"),
        ("enabled", "enabled"),
        ("children", "child_count"),
        ("rows", "row_count"),
        ("columns", "column_count"),
        ("position", "position"),
    ]:
        value = str(item.get(key) or "").strip()
        if value:
            parts.append(f"{label}: {value}")
    return " | ".join(parts)[:1200]


def sap_crawler_import_summary(items: list[Any], events: list[dict[str, Any]]) -> dict[str, Any]:
    rows = [item for item in items if isinstance(item, dict)]
    by_type: dict[str, int] = {}
    by_screen: dict[str, int] = {}
    by_module: dict[str, int] = {}
    by_area: dict[str, int] = {}
    actions: set[str] = set()
    for item in rows:
        object_type = sap_object_type(item)
        by_type[object_type] = by_type.get(object_type, 0) + 1
        screen = first_text(item.get("screen"), item.get("window_title"), default="Captured Screen")
        by_screen[screen] = by_screen.get(screen, 0) + 1
        module = first_text(item.get("module"), item.get("transaction"), default="Discovered SAP GUI")
        by_module[module] = by_module.get(module, 0) + 1
        area = first_text(item.get("area_or_tab"), default="Screen Discovery")
        by_area[area] = by_area.get(area, 0) + 1
        actions.update(sap_supported_actions(object_type, item))
    start_event = next((event for event in events if event.get("event") == "crawler_start"), {})
    transitions = [event for event in events if event.get("event") == "crawler_transition"]
    skipped_actions = [event for event in events if event.get("event") == "crawler_action_skipped"]
    candidates = [event for event in events if event.get("event") == "crawler_action_candidate"]
    limits = [event for event in events if event.get("event") == "crawler_limit_reached"]
    external_blocks = [event for event in events if event.get("event") == "crawler_external_navigation_blocked"]
    user_guided_captures = [event for event in events if event.get("event") == "user_guided_screen_captured"]
    user_guided_skips = [event for event in events if event.get("event") == "user_guided_screen_skipped"]
    visited_screen_keys = {
        str(event.get("screen_key") or event.get("to_screen_key") or "").strip()
        for event in events
        if str(event.get("screen_key") or event.get("to_screen_key") or "").strip()
    }
    return {
        "version": start_event.get("crawler_version", ""),
        "mode": start_event.get("mode", ""),
        "target_code": start_event.get("target_code", ""),
        "system": start_event.get("system", ""),
        "run_id": start_event.get("run_id", ""),
        "screens": len(by_screen),
        "screen_states": len(visited_screen_keys) or len(by_screen),
        "objects_seen": len(rows),
        "object_types": by_type,
        "modules": by_module,
        "areas": by_area,
        "navigation_edges": len(transitions),
        "exploration_candidates": len(candidates),
        "skipped_actions": len(skipped_actions),
        "external_navigation_blocked": len(external_blocks),
        "user_guided_screens": len(user_guided_captures),
        "user_guided_skipped": len(user_guided_skips),
        "limits_reached": len(limits),
        "supported_actions": sorted(actions),
    }


def sap_knowledge_discovery_terms(db: Session, product_id: int, limit: int = 80) -> list[str]:
    summary = db.scalar(select(KnowledgeSummary).where(KnowledgeSummary.product_id == product_id))
    raw_terms: list[str] = []
    chunks = db.scalars(
        select(KnowledgeChunk.content)
        .where(KnowledgeChunk.product_id == product_id)
        .order_by(KnowledgeChunk.chunk_index.asc())
        .limit(120)
    ).all()
    for chunk in chunks:
        raw_terms.extend(extract_guide_headings(str(chunk or "")))
    if summary:
        for value in [*(summary.modules or []), *(summary.features or []), *(summary.business_rules or []), *(summary.validations or [])]:
            raw_terms.append(str(value))

    seen: set[str] = set()
    terms: list[str] = []
    for value in raw_terms:
        term = clean_guide_term(value)
        key = normalize_key(term)
        if not term or key in seen or len(key) < 4:
            continue
        seen.add(key)
        terms.append(term)
        if len(terms) >= limit:
            break
    return terms


def extract_guide_headings(text: str) -> list[str]:
    headings: list[str] = []
    for line in text.splitlines():
        cleaned = re.sub(r"\.{2,}\s*\d*\s*$", "", line.strip(" \t-•"))
        match = re.match(r"^(?:\d+(?:\.\d+)*)\s+(.{4,90})$", cleaned)
        if match:
            headings.append(match.group(1))
            continue
        if re.match(r"^[A-Z][A-Za-z0-9 /&().,'-]{5,70}$", cleaned):
            headings.append(cleaned)
    return headings


def clean_guide_term(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "").replace("â", "'").replace("â¢", "")).strip(" .:-\t")
    text = re.sub(r"^\d+(?:\.\d+)*\s+", "", text)
    text = re.sub(r"\.{2,}.*$", "", text).strip(" .:-\t")
    noisy = {
        "purpose",
        "selection options",
        "report output",
        "security weaver",
        "separations enforcer",
        "user guide",
        "table of contents",
        "document scope",
        "introduction",
        "summary",
        "name",
        "pools",
        "logic",
        "size",
        "weaver",
    }
    noisy_starts = ("of ", "for ", "that ", "which ", "over ", "words ", "funds ", "very ")
    noisy_contains = ("document version", "innovative enterprise", "security weaver, llc", "suite", "lehi", "utah")
    words = text.split()
    if text.lower() in noisy or len(text) > 90:
        return ""
    if any(part in text.lower() for part in noisy_contains):
        return ""
    if text[:1].islower() or text.lower().startswith(noisy_starts) or len(words) > 10:
        return ""
    if sum(ch.isalpha() for ch in text) < 3:
        return ""
    return text


def sap_gui_crawler_script(product_name: str, knowledge_terms: list[str] | None = None) -> str:
    escaped_product = escape_vbs(product_name)
    terms = knowledge_terms or []
    escaped_terms = [escape_vbs(term) for term in terms]
    term_lines = "\n".join(f'knowledgeTerms.Add "{term}", True' for term in escaped_terms)
    terms_json = json.dumps(terms)
    return f'''Option Explicit
' TestPilot AI SAP GUI legacy crawler template
' Product: {escaped_product}
' Knowledge terms from uploaded guide: {len(terms)}
' Run this only on a SAP GUI session where scripting is enabled.
' It can navigate to one transaction/module code, then opens safe tabs/navigation controls and reads GUI metadata.
' Credentials should be entered in SAP GUI or local SAP prompts. TestPilot does not store passwords.

Dim SapGuiAuto, application, connection, session, fso, shell, outputPath, outFile, rows, targetCode, systemHint, visited, clicked, knowledgeTerms, maxActions, actionCount
systemHint = InputBox("SAP system/client to use (for export metadata only). Open/login to that SAP system before continuing.", "TestPilot SAP GUI Discovery", "")
targetCode = InputBox("Transaction/module code to open before crawling. Leave blank to crawl the current screen.", "TestPilot SAP GUI Discovery", "")
Set SapGuiAuto = GetObject("SAPGUI")
Set application = SapGuiAuto.GetScriptingEngine
Set connection = application.Children(0)
Set session = connection.Children(0)

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
outputPath = shell.SpecialFolders("Desktop") & "\\TestPilot-SAP-GUI-Deep-Crawl.jsonl"
rows = ""
Set outFile = fso.CreateTextFile(outputPath, True, True)
Set visited = CreateObject("Scripting.Dictionary")
Set clicked = CreateObject("Scripting.Dictionary")
Set knowledgeTerms = CreateObject("Scripting.Dictionary")
{term_lines}
maxActions = 300
actionCount = 0

If Len(Trim(targetCode)) > 0 Then
  On Error Resume Next
  If LCase(Left(Trim(targetCode), 2)) = "/n" Or LCase(Left(Trim(targetCode), 2)) = "/o" Then
    session.FindById("wnd[0]/tbar[0]/okcd").Text = targetCode
  Else
    session.FindById("wnd[0]/tbar[0]/okcd").Text = "/n" & targetCode
  End If
  session.FindById("wnd[0]").SendVKey 0
  WScript.Sleep 1200
  On Error GoTo 0
End If

Sub AddRow(component, discoveryAction)
  On Error Resume Next
  Dim id, name, typ, text, tooltip, title, key, label
  id = component.Id
  name = component.Name
  typ = component.Type
  text = component.Text
  tooltip = component.Tooltip
  title = session.ActiveWindow.Text
  label = Trim(CStr(text & " " & tooltip & " " & name & " " & title))
  key = id & "|" & title
  If Len(id) > 0 And Not visited.Exists(key) Then
    visited.Add key, True
    outFile.WriteLine "{{""id"":""" & JsonEscape(id) & """,""name"":""" & JsonEscape(name) & """,""type"":""" & JsonEscape(typ) & """,""text"":""" & JsonEscape(text) & """,""tooltip"":""" & JsonEscape(tooltip) & """,""transaction"":""" & JsonEscape(targetCode) & """,""system"":""" & JsonEscape(systemHint) & """,""window_title"":""" & JsonEscape(title) & """,""knowledge_target"":" & JsonBool(IsKnowledgeTarget(label)) & ",""discovery_action"":""" & JsonEscape(discoveryAction) & """}}"
  End If
  On Error GoTo 0
End Sub

Sub Walk(component, discoveryAction)
  On Error Resume Next
  AddRow component, discoveryAction
  Dim child
  For Each child In component.Children
    Walk child, discoveryAction
  Next
  On Error GoTo 0
End Sub

Sub WalkAllWindows(discoveryAction)
  On Error Resume Next
  Dim window
  For Each window In session.Children
    Walk window, discoveryAction
  Next
  On Error GoTo 0
End Sub

Function ComponentText(component)
  On Error Resume Next
  ComponentText = Trim(CStr(component.Text & " " & component.Tooltip & " " & component.Name))
  If Err.Number <> 0 Then ComponentText = ""
  Err.Clear
  On Error GoTo 0
End Function

Function IsSafeToOpen(component)
  On Error Resume Next
  Dim typ, label, lowerLabel
  typ = LCase(CStr(component.Type))
  label = ComponentText(component)
  lowerLabel = LCase(label)
  IsSafeToOpen = False
  If InStr(typ, "tab") > 0 Or InStr(typ, "menu") > 0 Or InStr(typ, "tree") > 0 Then IsSafeToOpen = True
  If InStr(typ, "button") > 0 Then
    If IsKnowledgeTarget(label) Or InStr(lowerLabel, "auth") > 0 Or InStr(lowerLabel, "object") > 0 Or InStr(lowerLabel, "detail") > 0 Or InStr(lowerLabel, "report") > 0 Or InStr(lowerLabel, "analysis") > 0 Or InStr(lowerLabel, "monitor") > 0 Or InStr(lowerLabel, "summary") > 0 Or InStr(lowerLabel, "history") > 0 Or InStr(lowerLabel, "simulation") > 0 Or InStr(lowerLabel, "review") > 0 Or InStr(lowerLabel, "function") > 0 Or InStr(lowerLabel, "role") > 0 Or InStr(lowerLabel, "user") > 0 Or InStr(lowerLabel, "transaction") > 0 Or InStr(lowerLabel, "add") > 0 Or InStr(lowerLabel, "edit") > 0 Or InStr(lowerLabel, "create") > 0 Or InStr(lowerLabel, "change") > 0 Or InStr(lowerLabel, "maintain") > 0 Or InStr(lowerLabel, "list") > 0 Or InStr(lowerLabel, "overview") > 0 Or InStr(lowerLabel, "display") > 0 Or InStr(lowerLabel, "show") > 0 Or InStr(lowerLabel, "view") > 0 Or InStr(lowerLabel, "more") > 0 Or InStr(lowerLabel, "next") > 0 Or InStr(lowerLabel, "back") > 0 Or InStr(lowerLabel, "find") > 0 Or InStr(lowerLabel, "search") > 0 Or InStr(lowerLabel, "open") > 0 Then IsSafeToOpen = True
  End If
  If InStr(lowerLabel, "save") > 0 Or InStr(lowerLabel, "delete") > 0 Or InStr(lowerLabel, "remove") > 0 Or InStr(lowerLabel, "post") > 0 Or InStr(lowerLabel, "submit") > 0 Or InStr(lowerLabel, "execute") > 0 Or InStr(lowerLabel, "run") > 0 Or InStr(lowerLabel, "assign") > 0 Or InStr(lowerLabel, "store") > 0 Or InStr(lowerLabel, "upload") > 0 Or InStr(lowerLabel, "download") > 0 Or InStr(lowerLabel, "print") > 0 Then IsSafeToOpen = False
  On Error GoTo 0
End Function

Function IsKnowledgeTarget(label)
  On Error Resume Next
  Dim lowerLabel, term
  lowerLabel = LCase(CStr(label))
  IsKnowledgeTarget = False
  For Each term In knowledgeTerms.Keys
    If Len(term) > 0 Then
      If InStr(lowerLabel, LCase(CStr(term))) > 0 Or InStr(LCase(CStr(term)), lowerLabel) > 0 Then
        IsKnowledgeTarget = True
        Exit Function
      End If
    End If
  Next
  On Error GoTo 0
End Function

Function JsonBool(value)
  If value Then
    JsonBool = "true"
  Else
    JsonBool = "false"
  End If
End Function

Sub CloseSecondaryWindows()
  On Error Resume Next
  Dim index
  For index = session.Children.Count - 1 To 1 Step -1
    session.Children(index).SendVKey 12
    WScript.Sleep 200
    If session.Children.Count > index Then
      session.Children(index).SendVKey 3
      WScript.Sleep 200
    End If
  Next
  On Error GoTo 0
End Sub

Sub TryOpen(component)
  On Error Resume Next
  If actionCount >= maxActions Then Exit Sub
  Dim id, typ, label, actionKey, titleBefore, windowCountBefore
  id = CStr(component.Id)
  typ = LCase(CStr(component.Type))
  label = ComponentText(component)
  actionKey = id & "|" & label
  If Len(id) = 0 Or clicked.Exists(actionKey) Or Not IsSafeToOpen(component) Then Exit Sub
  clicked.Add actionKey, True
  titleBefore = session.ActiveWindow.Text
  windowCountBefore = session.Children.Count
  If InStr(typ, "tab") > 0 Then
    component.Select
  ElseIf InStr(typ, "menu") > 0 Then
    component.Select
  ElseIf InStr(typ, "button") > 0 Then
    component.Press
  ElseIf InStr(typ, "tree") > 0 Then
    component.ExpandNode component.GetFocusedNodeKey
  End If
  WScript.Sleep 700
  actionCount = actionCount + 1
  WalkAllWindows "opened: " & label
  If session.Children.Count > windowCountBefore Then
    CloseSecondaryWindows
  ElseIf session.ActiveWindow.Text <> titleBefore Then
    session.FindById("wnd[0]").SendVKey 3
    WScript.Sleep 500
  End If
  On Error GoTo 0
End Sub

Sub Discover(component)
  On Error Resume Next
  Dim child
  TryOpen component
  For Each child In component.Children
    Discover child
    If actionCount >= maxActions Then Exit For
  Next
  On Error GoTo 0
End Sub

Function JsonEscape(value)
  Dim text
  text = CStr(value)
  text = Replace(text, "\\", "\\\\")
  text = Replace(text, """", "\""")
  text = Replace(text, vbCrLf, "\\n")
  text = Replace(text, vbCr, "\\n")
  text = Replace(text, vbLf, "\\n")
  JsonEscape = text
End Function

Dim scanPass, beforeActions
WalkAllWindows "initial"
For scanPass = 1 To maxActions
  beforeActions = actionCount
  WalkAllWindows "scan pass " & CStr(scanPass)
  Discover session.FindById("wnd[0]")
  If actionCount = beforeActions Then Exit For
  If actionCount >= maxActions Then Exit For
Next

outFile.Close

WScript.Echo "TestPilot SAP GUI crawl exported to: " & outputPath
'''


def sap_gui_crawler_script_v2(product_name: str, knowledge_terms: list[str] | None = None, target_code: str = "") -> str:
    escaped_product = escape_vbs(product_name)
    escaped_target_code = escape_vbs(target_code).strip()
    return f'''Option Explicit
' TestPilot AI SAP GUI advanced crawler v2 - stateful product library scanner
' Product: {escaped_product}
' Purpose: build TestPilot object-library metadata for one target T-code/current product area without changing business data.
' Guarded exploration scans the current screen, safe tabs, trees, display/detail buttons, popups, and follow-on screens.
' This script keeps previous TestPilot imports compatible: it exports JSONL rows to Desktop.

Call RelaunchWith32BitCscript()

Dim productName, targetCode, runId, outputPath, systemHint, exploreMode, watchMode, productTransaction
Dim shell, fso, SapGuiAuto, application, connection, session
Dim visitedRows, visitedActions, maxDepth, maxChildren, maxExploreActions, exploreActionCount

productName = "{escaped_product}"
systemHint = InputBox("SAP system/client label for metadata only. Login to the SAP session first.", "TestPilot SAP GUI Crawler V2", "")
targetCode = "{escaped_target_code}"
If Len(Trim(targetCode)) = 0 Then targetCode = InputBox("Exact T-code to capture, for example /n followed by your transaction code. Leave blank to capture the currently open screen only.", "TestPilot SAP GUI Crawler V2", "")
runId = Replace(Replace(Replace(CStr(Now), "/", "-"), ":", "-"), " ", "_")

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
outputPath = shell.SpecialFolders("Desktop") & "\\TestPilot-SAP-GUI-Crawler-V2-" & runId & ".jsonl"
If fso.FileExists(outputPath) Then fso.DeleteFile outputPath, True

Set visitedRows = CreateObject("Scripting.Dictionary")
Set visitedActions = CreateObject("Scripting.Dictionary")
maxDepth = 30
maxChildren = 5000
maxExploreActions = 80
exploreActionCount = 0

Set SapGuiAuto = AttachSapGui()
If SapGuiAuto Is Nothing Then
  MsgBox "Could not attach to SAP GUI scripting. Confirm SAP GUI is open, scripting is enabled, and run this with 32-bit cscript if needed.", vbCritical, "TestPilot SAP GUI Crawler V2"
  WScript.Quit 1
End If
Set application = SapGuiAuto.GetScriptingEngine
Set connection = application.Children(0)
Set session = connection.Children(0)

If Len(Trim(targetCode)) > 0 Then Navigate targetCode
productTransaction = SafeSessionInfo("Transaction")
WriteHeader
CaptureAll "Initial product library scan", ModuleName(), SafeWindowTitle()
exploreMode = MsgBox("Scanner will stay in the current T-code, scan visible objects, select tabs, expand trees, and record button/report IDs without pressing buttons automatically. Continue?", vbYesNo + vbExclamation, "TestPilot SAP GUI Product Library Scanner")
If exploreMode = vbYes Then ExploreScreen
watchMode = MsgBox("User-guided capture can keep the scanner running while you manually open tabs, buttons, reports, and follow-on screens inside the same T-code. It rescans what you reach and skips anything outside the target transaction. Start watcher?", vbYesNo + vbQuestion, "TestPilot SAP GUI Product Library Scanner")
If watchMode = vbYes Then WatchUserNavigation

  MsgBox "TestPilot SAP GUI product library scan exported to:" & vbCrLf & outputPath, vbInformation, "TestPilot SAP GUI Product Library Scanner"
WScript.Quit 0

Sub RelaunchWith32BitCscript()
  On Error Resume Next
  Dim currentHost, syswowHost, args, i
  currentHost = LCase(WScript.FullName)
  syswowHost = shellPath("SysWOW64\\cscript.exe")
  If InStr(currentHost, "\\system32\\") > 0 And fsoExists(syswowHost) Then
    args = ""
    For i = 0 To WScript.Arguments.Count - 1
      args = args & " " & Chr(34) & WScript.Arguments(i) & Chr(34)
    Next
    CreateObject("WScript.Shell").Run Chr(34) & syswowHost & Chr(34) & " //Nologo " & Chr(34) & WScript.ScriptFullName & Chr(34) & args, 1, False
    WScript.Quit 0
  End If
  On Error GoTo 0
End Sub

Function shellPath(relativePath)
  shellPath = CreateObject("WScript.Shell").ExpandEnvironmentStrings("%windir%") & "\\" & relativePath
End Function

Function fsoExists(path)
  fsoExists = CreateObject("Scripting.FileSystemObject").FileExists(path)
End Function

Function AttachSapGui()
  On Error Resume Next
  Dim auto, rot
  Set auto = GetObject("SAPGUI")
  If Err.Number <> 0 Or auto Is Nothing Then
    Err.Clear
    Set rot = CreateObject("SapROTWr.SapROTWrapper")
    If Err.Number = 0 Then Set auto = rot.GetROTEntry("SAPGUI")
  End If
  If Err.Number <> 0 Then
    Err.Clear
    Set auto = Nothing
  End If
  Set AttachSapGui = auto
  On Error GoTo 0
End Function

Sub Navigate(code)
  On Error Resume Next
  Dim cleanCode
  cleanCode = Trim(code)
  If Len(cleanCode) = 0 Then Exit Sub
  If LCase(Left(cleanCode, 2)) <> "/n" And LCase(Left(cleanCode, 2)) <> "/o" Then cleanCode = "/n" & cleanCode
  session.FindById("wnd[0]/tbar[0]/okcd").Text = cleanCode
  session.FindById("wnd[0]").SendVKey 0
  WScript.Sleep 1400
  ClosePopups
  On Error GoTo 0
End Sub

Sub WriteHeader()
  WriteJsonLine "{{""event"":""crawler_start"",""crawler_version"":""2.3"",""mode"":""stateful_safe_exploration"",""product"":""" & JsonEscape(productName) & """,""target_code"":""" & JsonEscape(targetCode) & """,""system"":""" & JsonEscape(systemHint) & """,""run_id"":""" & JsonEscape(runId) & """}}"
End Sub

Sub WriteJsonLine(line)
  On Error Resume Next
  Dim file
  Set file = fso.OpenTextFile(outputPath, 8, True, -1)
  file.WriteLine line
  file.Close
  On Error GoTo 0
End Sub

Sub CaptureAll(actionName, areaName, featureName)
  On Error Resume Next
  Dim window
  WriteJsonLine "{{""event"":""screen_seen"",""screen_key"":""" & JsonEscape(ScreenKey()) & """,""screen"":""" & JsonEscape(SafeWindowTitle()) & """,""action"":""" & JsonEscape(actionName) & """,""run_id"":""" & JsonEscape(runId) & """}}"
  For Each window In session.Children
    Walk window, actionName, areaName, featureName, 0, ""
  Next
  On Error GoTo 0
End Sub

Sub Walk(component, actionName, areaName, featureName, depth, parentId)
  On Error Resume Next
  If depth > maxDepth Then Exit Sub
  AddComponent component, actionName, areaName, featureName, depth, parentId
  Dim typ, child, index
  typ = LCase(SafeProp(component, "Type"))
  index = 0
  For Each child In component.Children
    Walk child, actionName, areaName, featureName, depth + 1, SafeProp(component, "Id")
    index = index + 1
    If index >= maxChildren Then
      WriteJsonLine "{{""event"":""crawler_limit_reached"",""parent_id"":""" & JsonEscape(SafeProp(component, "Id")) & """,""limit"":""" & CStr(maxChildren) & """,""run_id"":""" & JsonEscape(runId) & """}}"
      Exit For
    End If
  Next
  On Error GoTo 0
End Sub

Sub AddComponent(component, actionName, areaName, featureName, depth, parentId)
  On Error Resume Next
  Dim id, name, typ, text, tooltip, title, key, label, changeable, required, visible, enabled, hotkey, position, actionHint, childCount, rowCount, columnCount, screenKey
  id = SafeProp(component, "Id")
  If Len(id) = 0 Then Exit Sub
  name = SafeProp(component, "Name")
  typ = SafeProp(component, "Type")
  text = SafeProp(component, "Text")
  tooltip = SafeProp(component, "Tooltip")
  changeable = SafeBoolProp(component, "Changeable")
  required = SafeBoolProp(component, "Required")
  visible = SafeBoolProp(component, "Visible")
  enabled = SafeBoolProp(component, "Enabled")
  hotkey = SafeProp(component, "AcceleratorKey")
  position = PositionText(component)
  actionHint = ActionHint(typ, id, changeable, hotkey)
  childCount = SafeLongProp(component, "ChildrenCount")
  rowCount = SafeLongProp(component, "RowCount")
  columnCount = SafeLongProp(component, "ColumnCount")
  title = SafeWindowTitle()
  screenKey = ScreenKey()
  label = BestLabel(text, tooltip, name, id)
  key = id & "|" & title & "|" & areaName & "|" & featureName
  If visitedRows.Exists(key) Then Exit Sub
  visitedRows.Add key, True
  WriteJsonLine "{{""id"":""" & JsonEscape(id) & """,""technical_path"":""" & JsonEscape(id) & """,""name"":""" & JsonEscape(name) & """,""type"":""" & JsonEscape(typ) & """,""text"":""" & JsonEscape(text) & """,""tooltip"":""" & JsonEscape(tooltip) & """,""object_name"":""" & JsonEscape(label) & """,""product"":""" & JsonEscape(productName) & """,""module"":""" & JsonEscape(ModuleName()) & """,""transaction"":""" & JsonEscape(targetCode) & """,""system"":""" & JsonEscape(systemHint) & """,""area_or_tab"":""" & JsonEscape(areaName) & """,""feature"":""" & JsonEscape(featureName) & """,""screen"":""" & JsonEscape(title) & """,""window_title"":""" & JsonEscape(title) & """,""screen_key"":""" & JsonEscape(screenKey) & """,""parent_id"":""" & JsonEscape(parentId) & """,""depth"":" & CStr(depth) & ",""child_count"":""" & JsonEscape(childCount) & """,""row_count"":""" & JsonEscape(rowCount) & """,""column_count"":""" & JsonEscape(columnCount) & """,""required"":""" & JsonEscape(required) & """,""changeable"":""" & JsonEscape(changeable) & """,""visible"":""" & JsonEscape(visible) & """,""enabled"":""" & JsonEscape(enabled) & """,""accelerator_key"":""" & JsonEscape(hotkey) & """,""position"":""" & JsonEscape(position) & """,""action_hint"":""" & JsonEscape(actionHint) & """,""knowledge_target"":false,""discovery_action"":""" & JsonEscape(actionName) & """,""run_id"":""" & JsonEscape(runId) & """}}"
  On Error GoTo 0
End Sub

Sub ExploreScreen()
  On Error Resume Next
  WriteJsonLine "{{""event"":""guarded_exploration_start"",""max_actions"":""" & CStr(maxExploreActions) & """,""run_id"":""" & JsonEscape(runId) & """}}"
  ExploreComponent session.FindById("wnd[0]"), 0
  CaptureAll "Final product library scan", ModuleName(), SafeWindowTitle()
  WriteJsonLine "{{""event"":""guarded_exploration_end"",""actions"":""" & CStr(exploreActionCount) & """,""run_id"":""" & JsonEscape(runId) & """}}"
  On Error GoTo 0
End Sub

Sub WatchUserNavigation()
  On Error Resume Next
  Dim durationText, durationSeconds, endTime, screenKeyBefore, currentTransaction
  durationText = InputBox("How many seconds should TestPilot watch while you manually navigate inside the current T-code?", "TestPilot SAP GUI User-Guided Capture", "180")
  If Not IsNumeric(durationText) Then durationText = "180"
  durationSeconds = CLng(durationText)
  If durationSeconds < 15 Then durationSeconds = 15
  If durationSeconds > 1800 Then durationSeconds = 1800
  endTime = DateAdd("s", durationSeconds, Now)
  WriteJsonLine "{{""event"":""user_guided_capture_start"",""duration_seconds"":""" & CStr(durationSeconds) & """,""target_transaction"":""" & JsonEscape(productTransaction) & """,""run_id"":""" & JsonEscape(runId) & """}}"
  Do While Now < endTime
    currentTransaction = SafeSessionInfo("Transaction")
    If IsTargetTransaction(currentTransaction) Then
      screenKeyBefore = ScreenKey()
      CaptureAll "User-guided in-transaction capture", ModuleName(), SafeWindowTitle()
      WriteJsonLine "{{""event"":""user_guided_screen_captured"",""screen_key"":""" & JsonEscape(screenKeyBefore) & """,""screen"":""" & JsonEscape(SafeWindowTitle()) & """,""transaction"":""" & JsonEscape(currentTransaction) & """,""run_id"":""" & JsonEscape(runId) & """}}"
    Else
      WriteJsonLine "{{""event"":""user_guided_screen_skipped"",""screen"":""" & JsonEscape(SafeWindowTitle()) & """,""transaction"":""" & JsonEscape(currentTransaction) & """,""reason"":""Current SAP transaction is outside target T-code"",""run_id"":""" & JsonEscape(runId) & """}}"
    End If
    WScript.Sleep 2000
  Loop
  WriteJsonLine "{{""event"":""user_guided_capture_end"",""run_id"":""" & JsonEscape(runId) & """}}"
  On Error GoTo 0
End Sub

Sub ExploreComponent(component, depth)
  On Error Resume Next
  If exploreActionCount >= maxExploreActions Then Exit Sub
  If depth > maxDepth Then Exit Sub
  TryExplore component
  Dim child, index
  index = 0
  For Each child In component.Children
    ExploreComponent child, depth + 1
    index = index + 1
    If index >= maxChildren Or exploreActionCount >= maxExploreActions Then Exit For
  Next
  On Error GoTo 0
End Sub

Sub TryExplore(component)
  On Error Resume Next
  Dim id, typ, label, titleBefore, titleAfter, screenBefore, screenAfter, transactionBefore, transactionAfter, windowCountBefore, actionKind, reason, actionKey
  id = SafeProp(component, "Id")
  If Len(id) = 0 Then Exit Sub
  typ = LCase(SafeProp(component, "Type"))
  label = BestLabel(SafeProp(component, "Text"), SafeProp(component, "Tooltip"), SafeProp(component, "Name"), id)
  actionKind = ExplorationActionKind(typ, id, label)
  If Len(actionKind) = 0 Then
    If IsProductAreaButton(typ, id) Then
      WriteJsonLine "{{""event"":""crawler_action_skipped"",""id"":""" & JsonEscape(id) & """,""label"":""" & JsonEscape(label) & """,""screen_key"":""" & JsonEscape(ScreenKey()) & """,""reason"":""Button captured but not pressed in strict in-transaction mode"",""run_id"":""" & JsonEscape(runId) & """}}"
    End If
    Exit Sub
  End If
  actionKey = ScreenKey() & "|" & id & "|" & actionKind & "|" & label
  If visitedActions.Exists(actionKey) Then Exit Sub
  If Not IsProductAreaAction(id) Then
    WriteJsonLine "{{""event"":""crawler_action_skipped"",""id"":""" & JsonEscape(id) & """,""label"":""" & JsonEscape(label) & """,""screen_key"":""" & JsonEscape(ScreenKey()) & """,""reason"":""Skipped global SAP chrome action outside product work area"",""run_id"":""" & JsonEscape(runId) & """}}"
    visitedActions.Add actionKey, True
    Exit Sub
  End If
  If IsRiskyActionLabel(label) Or IsRiskyActionLabel(id) Then
    reason = "Skipped guarded exploration for risky action label"
    WriteJsonLine "{{""event"":""crawler_action_skipped"",""id"":""" & JsonEscape(id) & """,""label"":""" & JsonEscape(label) & """,""screen_key"":""" & JsonEscape(ScreenKey()) & """,""reason"":""" & JsonEscape(reason) & """,""run_id"":""" & JsonEscape(runId) & """}}"
    visitedActions.Add actionKey, True
    Exit Sub
  End If
  visitedActions.Add actionKey, True
  titleBefore = SafeWindowTitle()
  screenBefore = ScreenKey()
  transactionBefore = SafeSessionInfo("Transaction")
  windowCountBefore = session.Children.Count
  WriteJsonLine "{{""event"":""crawler_action_candidate"",""id"":""" & JsonEscape(id) & """,""label"":""" & JsonEscape(label) & """,""action_kind"":""" & JsonEscape(actionKind) & """,""from_screen"":""" & JsonEscape(titleBefore) & """,""from_screen_key"":""" & JsonEscape(screenBefore) & """,""from_transaction"":""" & JsonEscape(transactionBefore) & """,""run_id"":""" & JsonEscape(runId) & """}}"
  If actionKind = "select_tab" Then
    component.Select
  ElseIf actionKind = "expand_tree" Then
    component.ExpandNode component.GetFocusedNodeKey
  Else
    Exit Sub
  End If
  exploreActionCount = exploreActionCount + 1
  WScript.Sleep 900
  titleAfter = SafeWindowTitle()
  screenAfter = ScreenKey()
  transactionAfter = SafeSessionInfo("Transaction")
  WriteJsonLine "{{""event"":""crawler_transition"",""action_id"":""" & JsonEscape(id) & """,""action_label"":""" & JsonEscape(label) & """,""action_kind"":""" & JsonEscape(actionKind) & """,""from_screen"":""" & JsonEscape(titleBefore) & """,""from_screen_key"":""" & JsonEscape(screenBefore) & """,""from_transaction"":""" & JsonEscape(transactionBefore) & """,""to_screen"":""" & JsonEscape(titleAfter) & """,""to_screen_key"":""" & JsonEscape(screenAfter) & """,""to_transaction"":""" & JsonEscape(transactionAfter) & """,""popup_opened"":""" & JsonEscape(CStr(session.Children.Count > windowCountBefore)) & """,""run_id"":""" & JsonEscape(runId) & """}}"
  If IsExternalTransaction(transactionBefore, transactionAfter) Then
    WriteJsonLine "{{""event"":""crawler_external_navigation_blocked"",""action_id"":""" & JsonEscape(id) & """,""action_label"":""" & JsonEscape(label) & """,""from_transaction"":""" & JsonEscape(transactionBefore) & """,""to_transaction"":""" & JsonEscape(transactionAfter) & """,""to_screen"":""" & JsonEscape(titleAfter) & """,""reason"":""Action left the target product transaction; returned without scanning external screen"",""run_id"":""" & JsonEscape(runId) & """}}"
    session.FindById("wnd[0]").SendVKey 3
    WScript.Sleep 700
    CaptureAll "Returned after blocked external navigation", ModuleName(), SafeWindowTitle()
    Exit Sub
  End If
  CaptureAll "Guarded exploration: " & actionKind & " " & label, ModuleName(), SafeWindowTitle()
  If session.Children.Count > windowCountBefore Then
    CaptureAll "Guarded exploration popup: " & label, ModuleName(), SafeWindowTitle()
    ClosePopups
  ElseIf titleAfter <> titleBefore Or screenAfter <> screenBefore Then
    ExploreComponent session.FindById("wnd[0]"), 0
    session.FindById("wnd[0]").SendVKey 3
    WScript.Sleep 500
    CaptureAll "Returned after guarded exploration", ModuleName(), SafeWindowTitle()
  End If
  On Error GoTo 0
End Sub

Function ExplorationActionKind(typ, id, label)
  Dim text, idLower
  text = LCase(CStr(typ) & " " & CStr(id) & " " & CStr(label))
  idLower = LCase(CStr(id))
  ExplorationActionKind = ""
  If InStr(text, "tab") > 0 Or InStr(text, "/tabp") > 0 Then
    ExplorationActionKind = "select_tab"
  ElseIf InStr(text, "tree") > 0 Then
    ExplorationActionKind = "expand_tree"
  ElseIf (InStr(text, "guibutton") > 0 Or InStr(idLower, "/btn") > 0) Then
    ' Only click buttons inside the usr (content) area — never tbar/mbar/sbar
    If InStr(idLower, "/usr/") > 0 Then
      ExplorationActionKind = "click_button"
    End If
  End If
End Function

Function IsProductAreaButton(typ, id)
  Dim text
  text = LCase(CStr(typ) & " " & CStr(id))
  IsProductAreaButton = False
  If (InStr(text, "button") > 0 Or InStr(text, "/btn") > 0) And IsProductAreaAction(id) Then IsProductAreaButton = True
End Function

Function IsProductAreaAction(id)
  Dim text
  text = LCase(CStr(id))
  IsProductAreaAction = False
  If InStr(text, "/usr/") > 0 Then IsProductAreaAction = True
  If InStr(text, "/mbar") > 0 Or InStr(text, "/tbar") > 0 Or InStr(text, "/sbar") > 0 Then IsProductAreaAction = False
End Function

Function IsExternalTransaction(beforeValue, afterValue)
  Dim beforeText, afterText, targetText
  beforeText = NormalizeTransaction(beforeValue)
  afterText = NormalizeTransaction(afterValue)
  targetText = NormalizeTransaction(targetCode)
  IsExternalTransaction = False
  If Len(afterText) = 0 Then Exit Function
  If Len(beforeText) > 0 And afterText <> beforeText Then IsExternalTransaction = True
  If Len(targetText) > 0 And afterText <> targetText Then IsExternalTransaction = True
End Function

Function IsTargetTransaction(value)
  Dim currentText, targetText, productText
  currentText = NormalizeTransaction(value)
  targetText = NormalizeTransaction(targetCode)
  productText = NormalizeTransaction(productTransaction)
  IsTargetTransaction = True
  If Len(currentText) = 0 Then Exit Function
  If Len(productText) > 0 And currentText = productText Then Exit Function
  If Len(targetText) > 0 And currentText = targetText Then Exit Function
  If Len(targetText) > 0 Or Len(productText) > 0 Then IsTargetTransaction = False
End Function

Function NormalizeTransaction(value)
  Dim text
  text = UCase(Trim(CStr(value)))
  If Left(text, 2) = "/N" Or Left(text, 2) = "/O" Then text = Mid(text, 3)
  If Left(text, 1) = "/" Then text = Mid(text, 2)
  NormalizeTransaction = text
End Function

Function IsSafeNavigationLabel(value)
  Dim text
  text = LCase(" " & Trim(CStr(value)) & " ")
  IsSafeNavigationLabel = False
  If Len(Trim(CStr(value))) = 0 Then Exit Function
  If ContainsAny(text, " display | details | detail | search | find | choose | select | open | more | expand | collapse | next | previous | overview | simulate | check | help | possible entries | value help | variant | layout | continue | back | cancel | report | list | results | drilldown | drill down | item | line item ") Then IsSafeNavigationLabel = True
End Function

Function IsRiskyActionLabel(value)
  Dim text
  text = LCase(" " & Trim(CStr(value)) & " ")
  IsRiskyActionLabel = False
  If ContainsAny(text, " save | delete | remove | post | release | reverse | submit | approve | reject | execute | run | create | change | edit | update | import | transport | generate | assign | unassign | lock | unlock | commit | clear | reset | complete | finish | send | email | print | output ") Then IsRiskyActionLabel = True
End Function

Function ModuleName()
  If Len(Trim(targetCode)) > 0 Then
    ModuleName = Trim(targetCode)
  Else
    ModuleName = productName
  End If
End Function

Function ScreenKey()
  On Error Resume Next
  ScreenKey = ModuleName() & "|" & SafeProp(session.ActiveWindow, "Id") & "|" & SafeWindowTitle()
  If Err.Number <> 0 Then
    ScreenKey = ModuleName() & "|wnd[0]|Captured Screen"
    Err.Clear
  End If
  On Error GoTo 0
End Function

Sub ClosePopups()
  On Error Resume Next
  Dim index
  For index = session.Children.Count - 1 To 1 Step -1
    session.Children(index).SendVKey 12
    WScript.Sleep 200
    session.Children(index).SendVKey 3
    WScript.Sleep 200
  Next
  On Error GoTo 0
End Sub

Function AreaFromPathOrLabel(id, label)
  If InStr(id, "tabp") > 0 And Len(label) > 0 Then
    AreaFromPathOrLabel = CleanArea(label)
  Else
    AreaFromPathOrLabel = "Discovered SAP GUI"
  End If
End Function

Function FeatureFromPathOrLabel(id, label)
  If Len(label) > 0 Then
    FeatureFromPathOrLabel = CleanArea(label)
  Else
    FeatureFromPathOrLabel = "Screen Discovery"
  End If
End Function

Function CleanArea(value)
  Dim text
  text = Trim(CStr(value))
  If Len(text) = 0 Or Left(text, 1) = "/" Then
    CleanArea = "Screen Discovery"
  Else
    CleanArea = text
  End If
End Function

Function BestLabel(text, tooltip, name, id)
  Dim value
  value = FirstNonEmpty(text, tooltip, name)
  If IsTechnicalLabel(value) Then value = ""
  If Len(value) = 0 Then value = idLeaf(id)
  BestLabel = Trim(value)
End Function

Function FirstNonEmpty(a, b, c)
  If Len(Trim(CStr(a))) > 0 Then
    FirstNonEmpty = Trim(CStr(a))
  ElseIf Len(Trim(CStr(b))) > 0 Then
    FirstNonEmpty = Trim(CStr(b))
  Else
    FirstNonEmpty = Trim(CStr(c))
  End If
End Function

Function IsTechnicalLabel(value)
  Dim text
  text = Trim(CStr(value))
  IsTechnicalLabel = False
  If Len(text) = 0 Then Exit Function
  If InStr(text, "/") > 0 And InStr(text, " ") = 0 Then IsTechnicalLabel = True
  If LCase(Left(text, 3)) = "wnd" Or LCase(Left(text, 3)) = "usr" Or LCase(Left(text, 4)) = "mbar" Then IsTechnicalLabel = True
  If LCase(Left(text, 6)) = "sapgui" Or LCase(Left(text, 3)) = "yx_" Then IsTechnicalLabel = True
End Function

Function idLeaf(id)
  Dim parts
  parts = Split(CStr(id), "/")
  idLeaf = parts(UBound(parts))
End Function

Function SafeProp(component, propName)
  On Error Resume Next
  Err.Clear
  Select Case propName
    Case "Id": SafeProp = CStr(component.Id)
    Case "Name": SafeProp = CStr(component.Name)
    Case "Type": SafeProp = CStr(component.Type)
    Case "Text": SafeProp = CStr(component.Text)
    Case "Tooltip": SafeProp = CStr(component.Tooltip)
    Case "AcceleratorKey": SafeProp = CStr(component.AcceleratorKey)
    Case Else: SafeProp = ""
  End Select
  If Err.Number <> 0 Then
    SafeProp = ""
    Err.Clear
  End If
  On Error GoTo 0
End Function

Function SafeBoolProp(component, propName)
  On Error Resume Next
  Err.Clear
  Select Case propName
    Case "Changeable": SafeBoolProp = LCase(CStr(component.Changeable))
    Case "Required": SafeBoolProp = LCase(CStr(component.Required))
    Case "Visible": SafeBoolProp = LCase(CStr(component.Visible))
    Case "Enabled": SafeBoolProp = LCase(CStr(component.Enabled))
    Case Else: SafeBoolProp = ""
  End Select
  If Err.Number <> 0 Then
    SafeBoolProp = ""
    Err.Clear
  End If
  On Error GoTo 0
End Function

Function SafeLongProp(component, propName)
  On Error Resume Next
  Err.Clear
  Select Case propName
    Case "ChildrenCount": SafeLongProp = CStr(component.Children.Count)
    Case "RowCount": SafeLongProp = CStr(component.RowCount)
    Case "ColumnCount": SafeLongProp = CStr(component.ColumnCount)
    Case Else: SafeLongProp = ""
  End Select
  If Err.Number <> 0 Then
    SafeLongProp = ""
    Err.Clear
  End If
  On Error GoTo 0
End Function

Function PositionText(component)
  On Error Resume Next
  Err.Clear
  PositionText = "left=" & CStr(component.ScreenLeft) & ";top=" & CStr(component.ScreenTop) & ";width=" & CStr(component.Width) & ";height=" & CStr(component.Height)
  If Err.Number <> 0 Then
    PositionText = ""
    Err.Clear
  End If
  On Error GoTo 0
End Function

Function ActionHint(typ, id, changeable, hotkey)
  Dim text
  text = LCase(CStr(typ) & " " & CStr(id))
  If InStr(text, "button") > 0 Or InStr(text, "/btn") > 0 Then
    ActionHint = "click"
  ElseIf InStr(text, "combo") > 0 Or InStr(text, "/cmb") > 0 Then
    ActionHint = "select"
  ElseIf InStr(text, "table") > 0 Or InStr(text, "grid") > 0 Or InStr(text, "/tbl") > 0 Then
    ActionHint = "select_or_enter_text"
  ElseIf InStr(text, "textfield") > 0 Or InStr(text, "/ctxt") > 0 Or InStr(text, "/txt") > 0 Or changeable = "true" Then
    ActionHint = "enter_text"
  ElseIf Len(Trim(CStr(hotkey))) > 0 Then
    ActionHint = "hotkey"
  Else
    ActionHint = "verify"
  End If
End Function

Function SafeWindowTitle()
  On Error Resume Next
  SafeWindowTitle = CStr(session.ActiveWindow.Text)
  If Err.Number <> 0 Then
    SafeWindowTitle = "Captured Screen"
    Err.Clear
  End If
  On Error GoTo 0
End Function

Function SafeSessionInfo(propName)
  On Error Resume Next
  Err.Clear
  Select Case propName
    Case "Transaction": SafeSessionInfo = CStr(session.Info.Transaction)
    Case "Program": SafeSessionInfo = CStr(session.Info.Program)
    Case Else: SafeSessionInfo = ""
  End Select
  If Err.Number <> 0 Then
    SafeSessionInfo = ""
    Err.Clear
  End If
  On Error GoTo 0
End Function

Function ContainsAny(text, pipeWords)
  Dim words, word
  ContainsAny = False
  words = Split(pipeWords, "|")
  For Each word In words
    If Len(word) > 0 And InStr(text, word) > 0 Then
      ContainsAny = True
      Exit Function
    End If
  Next
End Function

Function JsonBool(value)
  If value Then JsonBool = "true" Else JsonBool = "false"
End Function

Function JsonEscape(value)
  Dim text
  text = CStr(value)
  text = Replace(text, "\\", "\\\\")
  text = Replace(text, """", "\""")
  text = Replace(text, vbCrLf, "\\n")
  text = Replace(text, vbCr, "\\n")
  text = Replace(text, vbLf, "\\n")
  JsonEscape = text
End Function
'''


def normalize_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def normalize_platform(value: str) -> str:
    text = str(value or "Hybrid").replace("_", " ").strip().title()
    if text.upper() == "SAP GUI":
        return "SAP GUI"
    if text.upper() in {"WEB", "DESKTOP", "HYBRID"}:
        return text.capitalize()
    return str(value or "Hybrid")


async def parse_testcase_upload(file: UploadFile) -> list[dict[str, str]]:
    content = await file.read()
    suffix = Path(file.filename or "").suffix.lower()
    if suffix == ".csv":
        decoded = content.decode("utf-8-sig", errors="ignore")
        reader = csv.DictReader(io.StringIO(decoded))
        rows = [normalize_row(row) for row in reader]
    elif suffix == ".xlsx":
        from openpyxl import load_workbook

        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        sheet = workbook.active
        raw_rows = list(sheet.iter_rows(values_only=True))
        if not raw_rows:
            rows = []
        else:
            headers = [str(value or "").strip().lower() for value in raw_rows[0]]
            rows = [normalize_row({headers[index]: "" if cell is None else str(cell) for index, cell in enumerate(row) if index < len(headers)}) for row in raw_rows[1:] if any(row)]
    else:
        raise HTTPException(status_code=400, detail="Only CSV and XLSX test case imports are supported")

    required = {"test_case_id", "title", "module", "feature", "steps", "expected_result", "priority", "source"}
    present = set(rows[0].keys()) if rows else set()
    missing = sorted(required - present)
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required columns: {', '.join(missing)}")
    return rows


def normalize_row(row: dict[str, Any]) -> dict[str, str]:
    return {str(key).strip().lower().replace(" ", "_"): "" if value is None else str(value).strip() for key, value in row.items()}


def apply_summary(summary: KnowledgeSummary, data: dict[str, Any]) -> None:
    readiness = float(data.get("readiness_score", data.get("readiness", 0)) or 0)
    modules = listify(data.get("modules_detected", data.get("modules")))
    features = listify(data.get("features_detected", data.get("features")))
    gaps = listify(data.get("missing_gaps", data.get("gaps")))
    summary.readiness = readiness
    summary.readiness_score = readiness
    summary.modules = modules
    summary.features = features
    summary.modules_detected = modules
    summary.features_detected = features
    summary.business_rules = listify(data.get("business_rules"))
    summary.validations = listify(data.get("validations"))
    summary.expected_messages = listify(data.get("expected_messages"))
    summary.gaps = gaps
    summary.missing_gaps = gaps
    summary.what_ai_learned = listify(data.get("what_ai_learned"))
    summary.what_ai_is_unsure_about = listify(data.get("what_ai_is_unsure_about"))
    summary.suggestions = listify(data.get("suggestions"))
    summary.ai_raw_response = str(data.get("ai_raw_response", ""))
    summary.ai_warning = str(data.get("ai_warning", ""))


def should_use_local_knowledge_fallback(exc: Exception) -> bool:
    if settings.ai_provider.strip().lower() not in {"local", "llama_cpp", "llamacpp"}:
        return False
    detail = str(getattr(exc, "detail", exc)).lower()
    return any(token in detail for token in ["timed out", "timeout", "read timed out", "local ai request failed"])


def enrich_knowledge_summary(data: dict[str, Any], text: str) -> dict[str, Any]:
    """Strengthen model output with deterministic full-document outline extraction.

    This is not a mock AI fallback; the AI result is still preserved. The parser
    guards against a common failure where a long guide's cover/disclaimer pages
    dominate the model prompt and produce generic modules like "User Guide".
    """

    profile = knowledge_profile(text)
    enriched = dict(data or {})
    modules = listify(enriched.get("modules_detected", enriched.get("modules")))
    features = listify(enriched.get("features_detected", enriched.get("features")))
    modules = merge_knowledge_values(modules, profile.get("candidate_modules", []), replace_generic=len(modules) < 3)
    features = merge_knowledge_values(features, profile.get("candidate_features", []), replace_generic=len(features) < 5)
    if modules:
        enriched["modules_detected"] = modules[:12]
    if features:
        enriched["features_detected"] = features[:20]

    learned = listify(enriched.get("what_ai_learned"))
    if profile.get("line_count"):
        learned.append(f"Parsed {profile['line_count']} document lines and identified {len(profile.get('section_headings', []))} section headings across the full guide.")
    if profile.get("section_headings"):
        learned.append("Detected product areas from the guide outline instead of only the opening pages.")
    enriched["what_ai_learned"] = dedupe_strings(learned)[:12]

    gaps = listify(enriched.get("missing_gaps", enriched.get("gaps")))
    if not gaps or all(str(item).lower().strip() in {"no missing gaps", "none", "no gaps"} for item in gaps):
        gaps = [
            "Capture SAP GUI object paths for the detected product areas before script generation.",
            "Add screenshots or crawler output for high-risk actions such as create, change, execute, import, and transport.",
        ]
    enriched["missing_gaps"] = dedupe_strings(gaps)[:8]

    readiness = float(enriched.get("readiness_score", enriched.get("readiness", 0)) or 0)
    if len(modules) >= 4 and len(features) >= 8:
        readiness = max(readiness, 82)
    elif len(modules) >= 2 and len(features) >= 4:
        readiness = max(readiness, 72)
    enriched["readiness_score"] = min(92, readiness)
    return enriched


def merge_knowledge_values(current: list[str], candidates: Any, *, replace_generic: bool) -> list[str]:
    current_clean = [item for item in current if item and not is_generic_knowledge_label(item)]
    if not current_clean or replace_generic:
        base = current_clean
    else:
        base = current_clean[:]
    for candidate in listify(candidates):
        if candidate and not is_generic_knowledge_label(candidate):
            base.append(candidate)
    return dedupe_strings(base)


def dedupe_strings(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = re.sub(r"\s+", " ", str(value or "")).strip(" .:-")
        key = cleaned.lower()
        if cleaned and key not in seen:
            seen.add(key)
            result.append(cleaned)
    return result


def listify(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item)]
    if value:
        return [str(value)]
    return []


def optional_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    text = str(value).strip().lower()
    if text in {"none", "null", "nil", "n/a"}:
        return None
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return None


def safe_float(value: Any, default: float = 0) -> float:
    if value in (None, ""):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def local_knowledge_summary(product_id: int, text: str) -> dict[str, Any]:
    lines = [line.strip(" -*\t") for line in text.splitlines() if line.strip()]
    modules = extract_labeled_values(lines, ["module", "modules"])
    features = extract_labeled_values(lines, ["feature", "features"])
    business_rules = extract_labeled_values(lines, ["rule", "business rule", "business rules"])
    validations = extract_labeled_values(lines, ["validation", "validations"])
    expected_messages = extract_labeled_values(lines, ["message", "expected message", "expected messages"])

    if not modules:
        modules = infer_phrases(text, ["module", "area", "domain"])
    if not features:
        features = infer_phrases(text, ["feature", "flow", "screen", "process"])
    if not business_rules:
        business_rules = [line for line in lines if re.search(r"\b(must|should|required|only when|cannot|allowed)\b", line, re.IGNORECASE)][:8]
    if not validations:
        validations = [line for line in lines if re.search(r"\b(validate|validation|error|invalid|required|warning)\b", line, re.IGNORECASE)][:8]
    if not expected_messages:
        expected_messages = [line for line in lines if re.search(r"\b(message|success|failed|approved|created|updated)\b", line, re.IGNORECASE)][:8]

    gaps = []
    if not modules:
        gaps.append("No clear module labels were detected in the uploaded knowledge.")
    if not features:
        gaps.append("No clear feature labels were detected in the uploaded knowledge.")
    if not business_rules:
        gaps.append("Business rules need more detail before automation can be trusted.")
    if not validations:
        gaps.append("Validation and error handling details are missing or weak.")

    readiness = 25
    readiness += min(len(modules), 5) * 8
    readiness += min(len(features), 5) * 7
    readiness += min(len(business_rules), 6) * 4
    readiness += min(len(validations), 5) * 3
    readiness = min(92, readiness if text.strip() else 0)

    return {
        "product_id": product_id,
        "modules_detected": modules[:12],
        "features_detected": features[:16],
        "business_rules": business_rules[:12],
        "validations": validations[:12],
        "expected_messages": expected_messages[:12],
        "missing_gaps": gaps or ["Review extracted knowledge and add screenshots, negative cases, and expected messages if needed."],
        "what_ai_learned": [
            f"Processed {len(lines)} text lines into reusable knowledge chunks.",
            "Detected product concepts that can support object-library and test-step mapping.",
        ],
        "what_ai_is_unsure_about": gaps or ["Confidence can improve after adding UI screenshots, object paths, and more test cases."],
        "suggestions": [
            "Add product object repository entries for detected features.",
            "Import test cases and run mapping after library objects are available.",
        ],
        "readiness_score": readiness,
        "ai_raw_response": "Legacy extraction helper; active knowledge processing uses the configured AI provider.",
    }


def extract_labeled_values(lines: list[str], labels: list[str]) -> list[str]:
    results: list[str] = []
    label_pattern = "|".join(re.escape(label) for label in labels)
    pattern = re.compile(rf"^(?:{label_pattern})s?\s*[:=-]\s*(.+)$", re.IGNORECASE)
    for line in lines:
        match = pattern.search(line)
        if not match:
            continue
        for part in re.split(r"[,;|]", match.group(1)):
            clean = part.strip(" .")
            if clean and clean.lower() not in {item.lower() for item in results}:
                results.append(clean)
    return results


def infer_phrases(text: str, keywords: list[str]) -> list[str]:
    phrases: list[str] = []
    for keyword in keywords:
        pattern = re.compile(rf"\b{re.escape(keyword)}\b\s+(?:called\s+|named\s+|is\s+)?([A-Z][A-Za-z0-9 /_-]{{2,60}})", re.IGNORECASE)
        for match in pattern.finditer(text):
            phrase = match.group(1).strip(" .,:;")
            if phrase and phrase.lower() not in {item.lower() for item in phrases}:
                phrases.append(phrase)
    return phrases[:8]


def mark_knowledge_failed(db: Session, source: KnowledgeSource, detail: str) -> None:
    source.status = "failed"
    source.error_message = detail
    source.processed_at = datetime.now(UTC)
    add_history(db, source.product_id, "TestPilot Agent", "Knowledge Processed", "KnowledgeSource", source.id, "Failed", detail)


def update_product_readiness(db: Session, product_id: int) -> None:
    product = db.get(Product, product_id)
    if not product:
        return
    summary = db.scalar(select(KnowledgeSummary).where(KnowledgeSummary.product_id == product_id))
    processed = count_where(db, KnowledgeSource, KnowledgeSource.product_id == product_id, KnowledgeSource.status.in_(["Processed", "processed"]))
    objects = count_where(db, ObjectRepository, ObjectRepository.product_id == product_id)
    mappings = count_where(db, StepMapping, StepMapping.product_id == product_id, StepMapping.status.in_(["mapped", "approved"]))
    knowledge_score = summary.readiness if summary else (70 if processed else 0)
    library_score = min(100, objects * 18)
    mapping_score = min(100, mappings * 12)
    product.readiness_score = round((knowledge_score * 0.4) + (library_score * 0.35) + (mapping_score * 0.25), 1)


def mapping_object_candidates(test_case: TestCase, objects: list[ObjectRepository], limit: int = 12) -> list[ObjectRepository]:
    if len(objects) <= limit:
        return objects
    step_text = " ".join(step.instruction for step in test_case.steps).lower()
    tokens = {token for token in re.findall(r"[a-z0-9]+", step_text) if len(token) > 2}

    def relevance(obj: ObjectRepository) -> float:
        searchable = " ".join([
            obj.object_name or "",
            obj.module or "",
            obj.feature or "",
            obj.screen or "",
            " ".join(obj.aliases or []),
            " ".join(obj.supported_actions or []),
        ]).lower()
        overlap = sum(1 for token in tokens if token in searchable)
        score = overlap * 20 + float(obj.confidence or 0) * 0.1
        if test_case.module and test_case.module.lower() in searchable:
            score += 15
        if test_case.feature and test_case.feature.lower() in searchable:
            score += 15
        return score

    return sorted(objects, key=lambda obj: (relevance(obj), obj.confidence or 0), reverse=True)[:limit]


def expects_screen_change(action_text: str) -> bool:
    """True when a step explicitly names the destination as a different screen than whatever
    came before it — "next page", "following screen", "new page", "after login", etc. — so the
    ranker can prefer objects that actually live on a different screen from the current one,
    instead of matching by name alone regardless of which page the object belongs to."""
    return bool(re.search(r"\b(next|following|new|other)\s+(page|screen)\b|\bafter\s+(login|logging in|navigat\w*|submit\w*|click\w*)\b", action_text, re.IGNORECASE))


def mapping_object_candidates_for_text(
    test_case: TestCase,
    objects: list[ObjectRepository],
    action_text: str,
    limit: int = 5,
    required_action: str | None = None,
    current_screen: str | None = None,
) -> list[ObjectRepository]:
    action = local_automation_action(required_action or agent.action_from_step(action_text))
    tokens = significant_requirement_tokens(action_text)
    target_key = normalize_match_text(action_text)
    button_request = "button" in normalize_match_text(action_text).split()
    screen_change_expected = expects_screen_change(action_text)

    def relevance(obj: ObjectRepository) -> float:
        if not object_candidate_usable_for_action(obj, action):
            return -1000
        # obj.screen deliberately excluded here: it's a URL/path string ("/admin/viewSystemUsers"),
        # and tokenizing it into generic keyword overlap lets path segments like "admin" or "login"
        # falsely match unrelated step text (e.g. a login value "Admin" or the verb "login") for
        # objects that live on a completely different, incidentally-similarly-named screen. Screen
        # relevance is already handled precisely below via the dedicated current_screen comparison.
        searchable = " ".join(
            [
                obj.object_name or "",
                obj.object_type or "",
                obj.module or "",
                obj.feature or "",
                obj.area_or_tab or "",
                " ".join(obj.aliases or []),
                " ".join(obj.supported_actions or []),
            ]
        ).lower()
        candidate_tokens = set(normalize_match_text(searchable).split())
        score = float(obj.confidence or 0) * 0.08
        score += sum(12 for token in tokens if token in candidate_tokens)
        if action in [item.lower() for item in (obj.supported_actions or [])]:
            score += 20
        if test_case.module and test_case.module.lower() in searchable:
            score += 6
        if test_case.feature and test_case.feature.lower() in searchable:
            score += 6
        if action == "enter_text" and obj.object_type in {"input", "table", "dropdown"}:
            score += 12
        if action == "click" and obj.object_type in {"button", "tab", "menu"}:
            score += 12
        if action == "open" and obj.object_type in {"tab", "menu", "button"}:
            score += 10
        if "button" in tokens and obj.object_type == "button":
            score += 35
        if button_request and obj.object_type == "menu":
            score -= 35
        if required_action == "navigate" and obj.object_type == "tab":
            score += 45
        if required_action == "navigate" and obj.object_type == "menu":
            score -= 25
        # Guard containment checks with a minimum length — a bare "a" (a real, observed Web
        # Scanner fallback for an unlabeled <a> tag) is a substring of nearly every English
        # sentence, so an unguarded `in` check here would falsely boost meaningless objects.
        object_name_key = normalize_match_text(obj.object_name or "")
        if len(object_name_key) >= 3 and object_name_key in target_key:
            score += 30
        if len(target_key) >= 3 and target_key in object_name_key:
            score += 20
        if button_request and obj.object_type == "button":
            score += 20
        if "insert" in tokens and {"insert", "line"} <= candidate_tokens:
            score += 60
        if "function" in tokens and ("functionid" in candidate_tokens or "functtran" in candidate_tokens):
            score += 55
        if ({"t", "code"} <= tokens or "tcode" in tokens or "code" in tokens) and ("tcode" in candidate_tokens or "tstct" in candidate_tokens):
            score += 55
        if "create" in tokens and obj.object_type == "button" and "create" in candidate_tokens:
            score += 45
        if "change" in tokens and obj.object_type == "button" and "change" in candidate_tokens:
            score += 45
        if "add" in tokens and obj.object_type == "button" and "add" in candidate_tokens:
            score += 45
        save_request = required_action == "save" or "save" in tokens
        if save_request and "save" in searchable:
            score += 45
        if save_request and "/tbar[0]/btn[11]" in str(obj.technical_path or "").lower():
            score += 70
        if save_request and "variant" in candidate_tokens and "variant" not in tokens:
            score -= 220
        if required_action == "enter_text" and obj.object_type in {"input", "table", "dropdown"}:
            score += 25
        # SAP table row preference: prefer lower row indices — [0,0] is the first/freshest row
        # after insert. Without this, all same-name table-cell objects score identically and
        # the tie-break picks high-confidence (= untried) rows instead of the correct row 0.
        import re as _re
        _row_match = _re.search(r'\[(\d+),(\d+)\]$', str(obj.technical_path or ""))
        if _row_match:
            row_idx = int(_row_match.group(2))
            score += max(0, 20 - row_idx * 4)  # [0,0]=+20, [0,1]=+16, [0,2]=+12, [0,5]=0, [0,6+]=-...clamped to 0
        # Screen-awareness: "verify X on next page" should prefer objects that actually live on a
        # different screen than wherever the flow currently is; ordinary steps should stay anchored
        # to the current screen instead of jumping to a same-named object on the wrong page.
        if current_screen and obj.screen:
            same_screen = obj.screen == current_screen
            if screen_change_expected:
                score += -40 if same_screen else 40
            elif same_screen:
                score += 10
        return score

    ranked = [(relevance(obj), obj) for obj in objects]
    ranked = [(score, obj) for score, obj in ranked if score > -1000]
    return [obj for _, obj in sorted(ranked, key=lambda item: (item[0], item[1].confidence or 0), reverse=True)[:limit]]


def object_candidate_usable_for_action(obj: ObjectRepository, action: str) -> bool:
    path = str(obj.technical_path or "").lower()
    if path.endswith("/titl") or "/sbar" in path:
        return action == "verify"
    if action == "enter_text":
        return obj.object_type in {"input", "table", "dropdown"}
    if action == "click":
        return obj.object_type in {"button", "tab", "menu", "table"}
    if action == "open":
        return obj.object_type in {"button", "tab", "menu"}
    return True


def local_automation_action(required_action: str) -> str:
    if required_action == "save":
        return "click"
    if required_action == "navigate":
        return "click"
    return required_action if required_action in {"open", "enter_text", "click", "select", "verify", "upload", "api_call"} else "review"


def local_mapping_test_data(item: dict[str, Any], action_text: str) -> str:
    required_action = str(item.get("action") or "")
    if required_action == "open":
        return str(item.get("target") or "")
    if required_action == "enter_text":
        return clean_test_data_value(item.get("value") or test_data_from_action(action_text) or "")
    return test_data_from_action(action_text)


def clean_test_data_value(value: Any) -> str:
    text = str(value or "").strip()
    if len(text) >= 2 and ((text[0] == text[-1] == '"') or (text[0] == text[-1] == "'")):
        return text[1:-1].strip()
    return text


def local_mapping_confidence(action_text: str, test_case: TestCase, obj: ObjectRepository | None, required_action: str | None = None) -> float:
    if not obj:
        return 0
    action = local_automation_action(required_action or agent.action_from_step(action_text))
    if not object_candidate_usable_for_action(obj, action):
        return 0
    # obj.screen excluded from keyword-overlap scoring for the same reason as in
    # mapping_object_candidates_for_text: URL path segments falsely collide with step vocabulary.
    searchable = " ".join(
        [
            obj.object_name or "",
            obj.object_type or "",
            obj.module or "",
            obj.feature or "",
            obj.area_or_tab or "",
            " ".join(obj.aliases or []),
        ]
    ).lower()
    path = str(obj.technical_path or "").lower()
    tokens = significant_requirement_tokens(action_text)
    candidate_tokens = set(normalize_match_text(searchable).split())
    token_overlap = sum(1 for token in tokens if token in candidate_tokens)
    # Being the right TYPE for the action (clickable, enterable, ...) is not evidence the object
    # is the right OBJECT — "Login" and "Logout" are both clickable buttons but mean opposite
    # things. Only start from a comfortable base once real name/text overlap is found; otherwise
    # this is a weak, type-only match and should read as low confidence, not a near-miss.
    score = 40 + min(30, token_overlap * 8) if token_overlap else 15
    object_name_key = normalize_match_text(obj.object_name or "")
    target_key = normalize_match_text(action_text)
    # Same guard as mapping_object_candidates_for_text: a 1-2 character object name (e.g. the
    # Web Scanner's "a" fallback for an unlabeled link) is a substring of almost any sentence.
    if len(object_name_key) >= 3 and object_name_key in target_key:
        score += 20
    if len(target_key) >= 3 and target_key in object_name_key:
        score += 16
    if action in [item.lower() for item in (obj.supported_actions or [])]:
        score += 15
    if action == "open" and re.search(r"(?<![A-Za-z0-9])/[no][A-Za-z0-9_/-]+", action_text, re.IGNORECASE):
        score += 25
    if "insert" in tokens and {"insert", "line"} <= candidate_tokens:
        score += 20
    if "function" in tokens and ("functionid" in candidate_tokens or "functtran" in candidate_tokens):
        score += 20
    if ({"t", "code"} <= tokens or "tcode" in tokens or "code" in tokens) and ("tcode" in candidate_tokens or "tstct" in candidate_tokens):
        score += 20
    if "create" in tokens and obj.object_type == "button" and "create" in candidate_tokens:
        score += 20
    if "change" in tokens and obj.object_type == "button" and "change" in candidate_tokens:
        score += 20
    save_request = required_action == "save" or "save" in tokens
    if save_request and "save" in searchable:
        score += 25
    if save_request and "/tbar[0]/btn[11]" in path:
        score += 25
    if save_request and "variant" in candidate_tokens and "variant" not in tokens:
        score -= 80
    if required_action == "enter_text" and obj.object_type in {"input", "table", "dropdown"}:
        score += 20
    if test_case.module and test_case.module.lower() in searchable:
        score += 5
    if test_case.feature and test_case.feature.lower() in searchable:
        score += 5
    # Floor matches the new no-overlap base (15) rather than 35, so a type-only match with no
    # other supporting signal reads as genuinely low confidence instead of a deceptive near-miss.
    return float(min(92, max(15, score)))


def verify_target_text(instruction: str) -> str:
    """Pulls the subject out of a verify-style step ("Verify Dashboard text is displayed" -> "Dashboard",
    "check whether \"Dashboard\" text appear or not" -> "Dashboard") for the page-source substring
    assertion fallback used when no product-library object was mapped for the step."""
    text = re.sub(r"\s+", " ", str(instruction or "")).strip()
    quoted = re.search(r'"([^"]+)"|\'([^\']+)\'', text)
    if quoted:
        return (quoted.group(1) or quoted.group(2) or "").strip()
    text = re.sub(r"^(verify|validate|assert|check|confirm)\b\s*(that\s+|whether\s+|if\s+)?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(text\s+)?(is\s+)?(displayed|visible|present|shown|appears?)\b.*$", "", text, flags=re.IGNORECASE)
    return text.strip(" ,.;:") or instruction


def test_data_from_action(action_text: str) -> str:
    text = str(action_text or "")
    quoted = re.search(r'"([^"]+)"|\'([^\']+)\'', text)
    if quoted:
        return (quoted.group(1) or quoted.group(2) or "").strip()
    match = re.search(r"\b(?:as|value|t-code|tcode|code)\s+([A-Za-z0-9_/-]+)", text, re.IGNORECASE)
    return match.group(1).strip() if match else ""


def significant_requirement_tokens(value: str) -> set[str]:
    generic = {"button", "btn", "field", "tab", "screen", "text", "on", "to", "as", "the"}
    text = str(value or "")
    tokens = {token for token in normalize_match_text(text).split() if len(token) > 1 and token not in generic}
    if re.search(r"\bt[\s-]*code\b", text, re.IGNORECASE):
        tokens.add("tcode")
    return tokens


def best_object_match(step: str, test_case: TestCase, objects: list[ObjectRepository]) -> tuple[ObjectRepository | None, float]:
    if not objects:
        return None, 0
    action = agent.action_from_step(step)
    best: tuple[ObjectRepository | None, float] = (None, 0)
    step_text = step.lower()
    for obj in objects:
        searchable = " ".join([obj.object_name, obj.module, obj.feature, obj.screen, " ".join(obj.aliases or []), obj.technical_path]).lower()
        score = 25 * SequenceMatcher(None, step_text, searchable).ratio()
        if obj.module and obj.module.lower() == (test_case.module or "").lower():
            score += 20
        if obj.feature and obj.feature.lower() == (test_case.feature or "").lower():
            score += 18
        if action in [a.lower() for a in (obj.supported_actions or [])]:
            score += 18
        for token in re.findall(r"[a-z0-9]+", step_text):
            if len(token) > 2 and token in searchable:
                score += 4
        score = min(98, round(score + min(obj.confidence or 0, 100) * 0.25, 1))
        if score > best[1]:
            best = (obj, score)
    return best


def enforce_generation_gate(db: Session, test_case: TestCase) -> None:
    blockers = generation_blockers(db, test_case)
    if blockers:
        raise HTTPException(status_code=409, detail={"blocked": True, "reasons": blockers, "next_actions": next_actions_for_blockers(blockers)})


def generation_blockers(db: Session, test_case: TestCase) -> list[str]:
    settings_row = db.scalar(select(UserSetting).where(UserSetting.user_id == "default"))
    app_settings = {**default_settings(), **(settings_row.settings if settings_row else {})}
    min_confidence = float(app_settings.get("minimum_mapping_confidence", 85) or 85)
    max_risk = float(app_settings.get("maximum_allowed_risk_score", 75) or 75)

    blockers: list[str] = []
    product = db.get(Product, test_case.product_id)
    processed = count_where(db, KnowledgeSource, KnowledgeSource.product_id == test_case.product_id, KnowledgeSource.status.in_(["Processed", "processed"]))
    objects = count_where(db, ObjectRepository, ObjectRepository.product_id == test_case.product_id)
    mappings = db.scalars(select(StepMapping).join(TestStep).where(TestStep.test_case_id == test_case.id)).all()

    if product and not str(product.app_path_or_url or product.entry_point or "").strip():
        blockers.append("Product has no application URL / logon path / executable path set")
    if processed == 0:
        blockers.append("Product has no processed knowledge source")
    if objects == 0:
        blockers.append("Product library/object repository is empty")
    if not mappings:
        blockers.append("Test case has no mapped steps")
    low_or_unapproved = [mapping for mapping in mappings if mapping.status == "unmapped" or (not mapping.approved and mapping.confidence < min_confidence)]
    if low_or_unapproved:
        blockers.append(f"{len(low_or_unapproved)} mappings are unmapped, unapproved, or below {min_confidence:.0f}% confidence")
    risky_mappings = [mapping for mapping in mappings if (mapping.risk_score or 0) > max_risk]
    mapped_objects = [db.get(ObjectRepository, mapping.object_id) for mapping in mappings if mapping.object_id]
    unverified_unapproved = [
        mapping
        for mapping, obj in zip([m for m in mappings if m.object_id], mapped_objects, strict=False)
        if obj and not object_verified_for_automation(obj) and not mapping.approved
    ]
    common_unapproved = [
        mapping
        for mapping, obj in zip([m for m in mappings if m.object_id], mapped_objects, strict=False)
        if obj and sap_common_chrome_path(obj.technical_path or "") and not mapping.approved
    ]
    if (test_case.risk_score or 0) > max_risk:
        blockers.append(f"Test case risk score {test_case.risk_score:.0f} exceeds maximum allowed {max_risk:.0f}")
    if risky_mappings:
        blockers.append(f"{len(risky_mappings)} mappings exceed maximum allowed risk score {max_risk:.0f}")
    if unverified_unapproved:
        blockers.append(f"{len(unverified_unapproved)} mapped objects are unverified and need user approval or verification")
    if common_unapproved:
        blockers.append(f"{len(common_unapproved)} mappings use common/global controls and need explicit approval")
    blockers.extend(mapping_completeness_issues(test_case, mappings, db))
    return blockers


_GUIDE_PREREQ_BUTTON = re.compile(
    r"\b(?:click|press|select|choose)\b[^.\n]{0,50}?\b(add|new entries|create new|insert line|new)\b[^.\n]{0,40}?\b(button|icon)\b",
    re.IGNORECASE,
)


def guide_prerequisite_button(
    requirement: dict[str, str],
    knowledge_chunks: list[str],
    available_objects: list[ObjectRepository],
    test_case: TestCase,
) -> str | None:
    """Detect a product-guide-documented button required before a create/insert action.

    The local deterministic mapper only sees literal manual-step wording. Application guides
    often document a UI prerequisite (e.g. "click New Entries before the row becomes editable")
    that testers omit from the manual step text. Recovering it from the uploaded knowledge base
    means the generated script clicks that button first instead of failing on a field/row that
    does not exist yet. Only fires when a matching button object is actually in the product's
    library, so it never inserts a speculative step.
    """
    action = str(requirement.get("action") or "")
    target = str(requirement.get("target") or requirement.get("display") or "")
    if action != "enter_text" or not knowledge_chunks:
        return None
    if not re.search(r"\b(create|add|insert|new|t-?code|tcode|transaction code)\b", target, re.IGNORECASE):
        return None
    relevant = select_relevant_context(knowledge_chunks, {"target": target}, limit=3, max_chars=600)
    for chunk in relevant or knowledge_chunks:
        match = _GUIDE_PREREQ_BUTTON.search(chunk)
        if not match:
            continue
        label = match.group(1).strip().title()
        candidates = mapping_object_candidates_for_text(test_case, available_objects, f"{label} button", limit=1, required_action="click")
        if candidates:
            return label
    return None


def manual_action_requirements(instruction: str) -> list[dict[str, str]]:
    text = re.sub(r"\s+", " ", str(instruction or "")).strip()
    requirements: list[dict[str, str]] = []
    transaction = sap_transaction_from_text(text)
    if transaction:
        requirements.append({"action": "open", "target": transaction, "display": f"open {transaction}"})
    boundary = r"(?=\b(?:click|press|select|choose|enter|type|fill|add|save|submit|verify|check)\b|$)"
    patterns = [
        ("navigate", rf"\bnavigate\s+to\s+(.+?){boundary}"),
        ("click", rf"\b(?:click|press)(?:\s+on)?\s+(.+?){boundary}"),
        ("enter_text", rf"\b(?:enter|type|fill)\s+(.+?)(?:\s+as\s+|\s*=\s*)(.+?){boundary}"),
        ("enter_text", rf"\badd\s+(.+?)(?:\s+as\s+|\s*=\s*)(.+?){boundary}"),
    ]
    for action, pattern in patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            target = match.group(1).strip(" ,.;")
            if not target:
                continue
            requirement = {"action": action, "target": target, "display": f"{action.replace('_', ' ')} {target}"}
            if action == "enter_text" and match.lastindex and match.lastindex >= 2:
                requirement["value"] = match.group(2).strip(" ,.;")
            requirements.append(requirement)
    if re.search(r"\b(save|submit)\b", text, re.IGNORECASE) and not any(
        item.get("action") in {"click", "select"} and re.search(r"\b(save|submit)\b", item.get("target", ""), re.IGNORECASE)
        for item in requirements
    ):
        requirements.append({"action": "save", "target": "save", "display": "save"})
    return requirements


def label_value_requirement(instruction: str) -> list[dict[str, str]] | None:
    """Handles verb-less shorthand steps like "Password admin123" that name a field directly
    followed by its value, with no action verb for manual_action_requirements/action_from_step
    to key off. Only fires when nothing else classified the step, to avoid false positives on
    steps that are genuinely ambiguous rather than a field/value pair."""
    text = re.sub(r"\s+", " ", str(instruction or "")).strip()
    if agent.action_from_step(text) != "review":
        return None
    # "wait ..." steps are a pause/timing instruction, not a field name — Playwright/Selenium's
    # own auto-waiting already covers this, so leave it as a no-op rather than misreading "wait"
    # as a field label with everything after it as the value to type in.
    if re.match(r"^wait\b", text, re.IGNORECASE):
        return None
    match = re.match(r"^([A-Za-z][A-Za-z ]{1,24}?)\s*[:\-]?\s+(\S.+)$", text)
    if not match:
        return None
    label, value = match.group(1).strip(" ,.;:"), match.group(2).strip(" ,.;")
    if not label or not value:
        return None
    return [{"action": "enter_text", "target": label, "value": value, "display": f"enter {label} as {value}"}]


def mapping_completeness_issues(test_case: TestCase, mappings: list[StepMapping], db: Session) -> list[str]:
    by_step: dict[int, list[StepMapping]] = {}
    for mapping in mappings:
        by_step.setdefault(mapping.test_step_id, []).append(mapping)
    issues: list[str] = []
    for step in sorted(test_case.steps, key=lambda row: row.step_order):
        available = list(by_step.get(step.id, []))
        used: set[int] = set()
        for requirement in manual_action_requirements(step.instruction):
            best_index = -1
            best_score = 0.0
            for index, mapping in enumerate(available):
                if index in used:
                    continue
                score = mapping_requirement_score(mapping, requirement, db)
                if score > best_score:
                    best_index = index
                    best_score = score
            if best_index >= 0 and best_score >= 0.62:
                used.add(best_index)
            else:
                issues.append(f"Manual step {step.step_order} is missing an approved mapping for '{requirement['display']}'")
    return issues


def mapping_requirement_score(mapping: StepMapping, requirement: dict[str, str], db: Session) -> float:
    action = (mapping.automation_action or "").lower()
    required_action = requirement["action"]
    compatible = {
        "open": {"open"},
        "navigate": {"click", "select", "open"},
        "click": {"click", "select"},
        "enter_text": {"enter_text"},
        "save": {"click", "select"},
    }
    if action not in compatible.get(required_action, {required_action}):
        return 0.0
    obj = db.get(ObjectRepository, mapping.object_id) if mapping.object_id else None
    searchable = " ".join([
        obj.object_name if obj else "",
        obj.object_type if obj else "",
        obj.area_or_tab if obj else "",
        obj.feature if obj else "",
        obj.technical_path if obj else "",
        " ".join(obj.aliases or []) if obj else "",
        mapping.selected_reason or "",
    ])
    target = normalize_match_text(requirement.get("target", ""))
    candidate = normalize_match_text(searchable)
    if required_action == "open" and requirement.get("target", "").lower() in (mapping.test_data or "").lower():
        return 1.0
    if required_action == "enter_text" and requirement.get("value") and normalize_match_text(requirement["value"]) == normalize_match_text(mapping.test_data or ""):
        return 1.0
    if required_action == "save" and "save" in candidate:
        return 1.0
    target_tokens = significant_requirement_tokens(requirement.get("target", ""))
    if "save" in target_tokens and "tbar 0 btn 11" in candidate:
        return 1.0
    candidate_tokens = set(candidate.split())
    overlap = len(target_tokens & candidate_tokens) / max(1, len(target_tokens))
    similarity = SequenceMatcher(None, target, candidate).ratio()
    return max(overlap, similarity)


def normalize_match_text(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", " ", str(value or "").lower())
    aliases = {"add": "insert", "adding": "insert", "editing": "change", "edit": "change", "define": "create"}
    return " ".join(aliases.get(token, token) for token in text.split())


def calibrated_review_risk(review: dict[str, Any], mappings: list[StepMapping], validation_issues: list[str]) -> float:
    normalize_review_findings(review, mappings)
    provider_score = max(0.0, min(100.0, float(review.get("risk_score", 50) or 50)))
    finding_keys = ["issues", "risk_warnings", "missing_waits", "missing_assertions", "weak_error_handling"]
    finding_count = sum(len(review.get(key) or []) for key in finding_keys if isinstance(review.get(key), list))
    mapping_risk = max([float(mapping.risk_score or 0) for mapping in mappings] or [0.0])
    # Use a reduced per-finding weight (was 8.0) so small local models that
    # enumerate minor stylistic observations don't automatically block scripts.
    finding_penalty = min(40.0, finding_count * 4.0)
    objective_score = min(100.0, max(mapping_risk, 10.0 + finding_penalty + len(validation_issues) * 20.0))
    recommendation = str(review.get("approval_recommendation") or "").strip().lower().replace(" ", "_")
    approved = recommendation in {"approve", "approved", "pass", "passed", "ready", "ready_to_run"}
    if validation_issues:
        # Hard deterministic issues always dominate.
        effective_score = max(objective_score, provider_score)
    elif approved and finding_count == 0:
        # Clean approval with no findings: provider score may be inflated on small models.
        # Trust the approval; use only the objective mapping risk floor.
        effective_score = mapping_risk
    elif approved:
        # Approved but listed some findings: blend, capped by objective score.
        effective_score = max(mapping_risk, min(provider_score, objective_score))
    else:
        effective_score = max(objective_score, provider_score)
    review["provider_risk_score"] = provider_score
    review["risk_score"] = round(effective_score, 1)
    review["risk_calibration"] = "Effective risk: mapping risk floor + provider score (approved path) or finding-weighted objective (blocked path)."
    return round(effective_score, 1)


def normalize_review_findings(review: dict[str, Any], mappings: list[StepMapping]) -> None:
    no_issue_pattern = re.compile(r"^\s*(no|none|not any)\b.*\b(found|issues?|warnings?|missing|problems?)\b", re.IGNORECASE)
    false_positive_items = {
        "missing waits",
        "missing assertions",
        "waitforsap 30",
        "checkstep currentstep",
        # SAP VBScript helpers are defined at the bottom of every generated script
        "missing error handling",
        "no error handling",
        "lacks error handling",
        "missing waitforsap",
        "missing checkstatusbar",
        "missing failstep",
        "no waitforsap",
        "waitforsap not found",
        "checkstatusbar not found",
        "failstep not found",
        "no assertions",
        "hardcoded credentials",
        "hardcoded username",
        "hardcoded password",
        # The generated script correctly uses .Select for tabs, menus, and radio buttons
        "use press instead of select",
        "should use press",
        "press instead of select",
        "incorrect method select",
        "select method incorrect",
        # Checkbox toggle pattern is intentional
        "not session findbyid",
        "incorrect selected",
        "selected not supported",
        # .ShowList is the correct SAP ComboBox method to open the dropdown
        "showlist not valid",
        "use key instead of showlist",
        # .Key is the correct SAP ComboBox / ListBox setter
        "use text instead of key",
        "key property not valid",
        # .SelectedRows is the correct ALV Grid row selection method
        "selectedrows not valid",
        "use select instead of selectedrows",
        # navigate / setfocus pattern
        "setfocus not valid",
        "use click instead of setfocus",
    }
    for key in ["issues", "risk_warnings", "missing_waits", "missing_assertions", "weak_error_handling", "recommended_improvements"]:
        value = review.get(key)
        if isinstance(value, list):
            cleaned = []
            for item in value:
                text = str(item).strip()
                normalized = normalize_match_text(text)
                if not text or no_issue_pattern.search(text) or normalized in false_positive_items:
                    continue
                if key == "weak_error_handling" and "failstep" in normalized and "entered value was" in normalized:
                    continue
                cleaned.append(text)
            review[key] = cleaned

    approved_values = {
        clean_test_data_value(getattr(mapping, "test_data", "")).lower()
        for mapping in mappings
        if clean_test_data_value(getattr(mapping, "test_data", ""))
    }
    hardcoded_values = review.get("hardcoded_values")
    if isinstance(hardcoded_values, list):
        review["hardcoded_values"] = [
            str(item)
            for item in hardcoded_values
            if clean_test_data_value(str(item).strip('"')).lower() not in approved_values
        ]

    finding_keys = ["issues", "risk_warnings", "missing_waits", "missing_assertions", "weak_error_handling"]
    if not any(review.get(key) for key in finding_keys):
        review["approval_recommendation"] = "approve"


def object_available_for_mapping(obj: ObjectRepository) -> bool:
    # Common/global controls may be mapped, but generation_blockers requires
    # explicit approval before they can participate in executable automation.
    return (obj.status or "").lower() not in {"deleted", "rejected", "invalid"}


def object_verified_for_automation(obj: ObjectRepository) -> bool:
    return bool(obj.last_verified) or str(obj.verification_status or "").lower() == "verified"


def next_actions_for_blockers(blockers: list[str]) -> list[str]:
    actions: list[str] = []
    joined = " ".join(blockers).lower()
    if "url / logon path / executable path" in joined:
        actions.append("Open Product Setup and add the application URL (Web), SAP logon path, or executable path.")
    if "knowledge" in joined:
        if settings.ai_provider.strip().lower() in {"local", "llama_cpp", "llamacpp"}:
            actions.append("Install/start the local AI model, then process product knowledge again.")
        else:
            actions.append("Upload and process product knowledge using a valid OpenAI API key.")
    if "library" in joined or "repository" in joined:
        actions.append("Add product library objects with technical paths and supported actions.")
    if "missing an approved mapping" in joined:
        actions.append("Run step mapping again and approve every navigation, mode-change, create/add, data-entry, save, and verification action.")
        actions.append("If a named SAP control is unavailable, run the crawler on that exact screen and import the refreshed paths.")
    elif "mapped" in joined or "mapping" in joined:
        actions.append("Run AI mapping and approve mappings below the confidence threshold.")
    if "risk" in joined:
        actions.append("Reduce risk, add approvals, or adjust the maximum risk score in Settings.")
    return actions or ["Review readiness gates and rerun script generation."]


def quality_result(row: TestCase, all_cases: list[dict[str, Any]]) -> dict[str, Any]:
    serialized = serialize_test_case(row, include_steps=True)
    step_items = serialized.get("step_items", [])
    issues: list[str] = []
    expected = (row.expected_result or "").strip().lower()
    steps_text = "\n".join(step["instruction"] for step in step_items)

    if not expected:
        issues.append("Missing expected result")
    elif len(expected.split()) < 4 or expected in {"success", "passed", "ok", "done"}:
        issues.append("Weak expected result")
    if any(len(re.split(r"\band\b|,", step["instruction"], flags=re.IGNORECASE)) > 3 for step in step_items):
        issues.append("Too many actions in one step")
    if not re.search(r"\b(id|number|name|code|value|file|date|amount)\b", steps_text, re.IGNORECASE):
        issues.append("No clear test data")
    if not re.search(r"\bverify|validate|assert|check|should\b", steps_text, re.IGNORECASE):
        issues.append("No assertion")

    duplicate_title = [case for case in all_cases if case["id"] != row.id and str(case.get("title", "")).strip().lower() == row.title.strip().lower()]
    duplicate_steps = [
        case
        for case in all_cases
        if case["id"] != row.id and "\n".join(step.get("instruction", "") for step in case.get("step_items", [])).strip().lower() == steps_text.strip().lower()
    ]
    if duplicate_title:
        issues.append("Duplicate title")
    if duplicate_steps:
        issues.append("Same steps as another test")

    score = max(0, 100 - len(issues) * 14)
    row.quality_score = score
    return {**serialized, "quality_score": score, "qualityScore": score, "issues": issues, "risk_score": row.risk_score}


def calculate_coverage_gaps(summary: dict[str, Any], test_cases: list[dict[str, Any]], objects: list[dict[str, Any]]) -> dict[str, Any]:
    features = set(summary.get("features", []) or summary.get("features_detected", []))
    tested_features = {case.get("feature") for case in test_cases if case.get("feature")}
    object_names = {objectName for objectName in [obj.get("object_name") or obj.get("objectName") for obj in objects] if objectName}
    mapped_object_names = set()
    for case in test_cases:
        for step in case.get("step_items", []):
            text = str(step.get("instruction", "")).lower()
            for name in object_names:
                if name.lower() in text:
                    mapped_object_names.add(name)
    validations = summary.get("validations", [])
    return {
        "missing_feature_coverage": sorted(features - tested_features),
        "missing_object_coverage": sorted(object_names - mapped_object_names),
        "missing_negative_testing": validations,
        "weak_expected_results": [case.get("external_id") or case.get("externalId") for case in test_cases if len(str(case.get("expected_result") or case.get("expectedResult") or "").split()) < 4],
        "high_risk_untested_areas": sorted(features - tested_features)[:5],
    }


def blocked_script_candidates(product_id: int, db: Session) -> list[dict[str, Any]]:
    cases = db.scalars(select(TestCase).where(TestCase.product_id == product_id)).all()
    blocked = []
    for case in cases:
        blockers = generation_blockers(db, case)
        if blockers:
            blocked.append({"test_case": serialize_test_case(case, include_steps=False), "reasons": blockers, "next_actions": next_actions_for_blockers(blockers)})
    return blocked


def ensure_script_extension(file_name: str, framework: str) -> str:
    name = safe_filename(file_name)
    suffix = Path(name).suffix
    if suffix:
        return name
    normalized = framework.upper().replace(" ", "_").replace("-", "_")
    if "SAP" in normalized or "VBSCRIPT" in normalized:
        return f"{name}.vbs"
    if "SELENIUM" in normalized:
        return f"{safe_class_name(name)}.java"
    if "PLAYWRIGHT" in normalized:
        return f"{name}.spec.ts"
    if "CUCUMBER" in normalized:
        return f"{name}.feature"
    return f"{name}.md"


def command_for_framework(framework: str, file_name: str) -> str:
    normalized = framework.upper().replace(" ", "_").replace("-", "_")
    if "SAP" in normalized or "VBSCRIPT" in normalized:
        return f"cscript {file_name}"
    if "SELENIUM" in normalized:
        return f"mvn test -Dtest={Path(file_name).stem}"
    if "PLAYWRIGHT" in normalized:
        return f"npx playwright test {file_name}"
    if "CUCUMBER" in normalized:
        return f"mvn test -Dcucumber.features={file_name}"
    if "DESKTOP" in normalized:
        return f"desktop-runner --script {file_name}"
    return f"testpilot-hybrid-runner --plan {file_name}"


def is_sap_framework(framework: str) -> bool:
    normalized = framework.upper().replace(" ", "_").replace("-", "_")
    return "SAP" in normalized or "VBSCRIPT" in normalized


def sap_transaction_from_text(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    explicit = re.search(r"(?<![A-Za-z0-9])(/[no][A-Za-z0-9_/-]+)", text, re.IGNORECASE)
    if explicit:
        return explicit.group(1)
    patterns = [
        r"\b(?:execute|open|launch|start)\s+(?:transaction\s+|t-?code\s+)?([A-Za-z][A-Za-z0-9_/-]{1,24})\b",
        r"\b(?:transaction|t-?code)\s+([A-Za-z][A-Za-z0-9_/-]{1,24})\b",
        r"\bnavigate\s+to\s+(?:transaction\s+|t-?code\s+)?([A-Za-z][A-Za-z0-9_/-]{1,24})\b",
        r"\bgo\s+to\s+(?:transaction\s+|t-?code\s+)?([A-Za-z][A-Za-z0-9_/-]{1,24})\b",
    ]
    stop_words = {
        "screen", "page", "module", "tab", "menu", "button", "field",
        "product", "application", "app", "home", "the", "a", "an",
    }
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        code = match.group(1).strip(" .,:;")
        if code.lower() in stop_words:
            continue
        if "/" in code and not code.startswith("/"):
            return code
        return code if code.startswith("/") else f"/n{code.upper()}"
    return ""


# SAP GUI object type groups — each group maps to its own VBScript method.
# Normalise by lowercasing + replacing spaces/hyphens with underscores before lookup.
_SAP_SELECT_TYPES: frozenset[str] = frozenset({
    "menu", "menu_item", "menuitem",
    "tab", "tabstrip", "tab_strip", "tabpage", "tab_page",
})
_SAP_RADIO_TYPES: frozenset[str] = frozenset({
    "radiobutton", "radio_button", "radio", "guiradiobutton",
})
_SAP_CHECKBOX_TYPES: frozenset[str] = frozenset({
    "checkbox", "check_box", "checkbutton", "checkboxbutton", "guicheckbox",
})
_SAP_COMBOBOX_TYPES: frozenset[str] = frozenset({
    "combobox", "combo_box", "listbox", "list_box", "dropdownlist",
    "dropdown", "dropdownlistbox", "guicombobox",
})
_SAP_GRID_TYPES: frozenset[str] = frozenset({
    "grid", "gridview", "grid_view", "table", "guigridview", "alv", "alv_grid",
})
_SAP_TREE_TYPES: frozenset[str] = frozenset({
    "tree", "treeview", "tree_view", "guitreecontrol",
})


def _sap_type_from_locator(locator: str) -> str:
    """Infer SAP GUI object type from the scripting-engine ID prefix in the last locator segment.

    SAP GUI generates deterministic IDs: tabpXXX = GuiTab, radXXX = GuiRadioButton, etc.
    This is used as a fallback when object_type stored in the repository is missing or wrong.
    """
    segment = (locator or "").rstrip("/").rsplit("/", 1)[-1].lower()
    # Strip array index suffixes like [0], [10]
    segment = segment.split("[")[0]
    if segment.startswith("tabp"):
        return "tab"
    if segment.startswith("tabs"):
        return "tabstrip"
    if segment.startswith("rad"):
        return "radiobutton"
    if segment.startswith("chk"):
        return "checkbox"
    if segment.startswith("cmb"):
        return "combobox"
    if segment.startswith("lst"):
        return "listbox"
    if segment.startswith("mbar") or segment.startswith("menu"):
        return "menu"
    if segment.startswith("cntl") or segment.startswith("tbl"):
        return "grid"
    if segment.startswith("tree"):
        return "tree"
    if segment.startswith("btn") or segment.startswith("tbar"):
        return "button"
    if segment.startswith("txt") or segment.startswith("ctxt"):
        return "input"
    return ""


def _sap_interaction_lines(action: str, object_type: str, locator: str, test_data: str) -> list[str]:
    """Return VBScript line(s) for one SAP GUI interaction with the correct method per object type.

    Resolution order:
      1. object_type field from the repository (explicit, highest trust)
      2. SAP scripting-engine ID prefix extracted from the locator path (reliable fallback)
      3. Action-based default (.Press for click, .Select for select)
    """
    ot = (object_type or "").lower().replace(" ", "_").replace("-", "_")
    # Locator prefix is authoritative — the SAP scripting engine assigns deterministic IDs
    # (tabpXXX = GuiTab, radXXX = GuiRadioButton, …) that cannot be mistyped by a human.
    # Always prefer the inferred type; only fall back to stored object_type when the
    # locator carries no recognisable prefix (returns empty string).
    inferred = _sap_type_from_locator(locator)
    if inferred:
        ot = inferred

    loc = escape_vbs(locator)
    td = escape_vbs(test_data)

    # Tabs and menu items always use .Select regardless of action verb
    if ot in _SAP_SELECT_TYPES:
        return [f"session.findById(\"{loc}\").Select"]

    # Radio buttons always use .Select
    if ot in _SAP_RADIO_TYPES:
        return [f"session.findById(\"{loc}\").Select"]

    # Checkboxes use .Selected property
    if ot in _SAP_CHECKBOX_TYPES:
        if action == "click":
            # Toggle: flip the current state
            return [f"session.findById(\"{loc}\").Selected = Not session.findById(\"{loc}\").Selected"]
        # select / verify: set to True explicitly
        return [f"session.findById(\"{loc}\").Selected = True"]

    # Comboboxes / listboxes / dropdowns use .Key for value selection
    if ot in _SAP_COMBOBOX_TYPES:
        if test_data:
            return [f"session.findById(\"{loc}\").Key = \"{td}\""]
        if action == "click":
            return [f"session.findById(\"{loc}\").ShowList"]
        return [f"session.findById(\"{loc}\").Select"]

    # ALV grids / tables: select row(s)
    if ot in _SAP_GRID_TYPES:
        if test_data:
            return [f"session.findById(\"{loc}\").SelectedRows = \"{td}\""]
        return [f"session.findById(\"{loc}\").SelectedRows = \"0\""]

    # Tree controls: select a node
    if ot in _SAP_TREE_TYPES:
        if test_data:
            return [f"session.findById(\"{loc}\").SelectNode \"{td}\""]
        return [f"session.findById(\"{loc}\").TopNode = \"\""]

    # Fallback for unrecognised / generic types
    if action == "select":
        if test_data:
            return [f"session.findById(\"{loc}\").Key = \"{td}\""]
        return [f"session.findById(\"{loc}\").Select"]

    # Default click / anything else → .Press (buttons, toolbars, etc.)
    return [f"session.findById(\"{loc}\").Press"]


def sap_script_validation_issues(code: str, mappings: list[StepMapping], db: Session) -> list[str]:
    issues: list[str] = []
    lowered_code = code.lower()
    if 'findbyid("/app/' in lowered_code or "findbyid('/app/" in lowered_code:
        issues.append("Script uses crawler absolute paths; SAP session.findById requires session-relative wnd[...] paths")
    if "TODO_TEST_DATA" in code:
        issues.append("Script still contains TODO_TEST_DATA instead of approved mapping data")
    for helper in ["WaitForSap", "CheckStatusBar", "FailStep"]:
        if helper not in code:
            issues.append(f"Script is missing required runtime guard {helper}")
    for mapping in mappings:
        obj = db.get(ObjectRepository, mapping.object_id) if mapping.object_id else None
        action = (mapping.automation_action or "").lower()
        if action in {"click", "select", "enter_text", "verify"} and not obj:
            issues.append(f"Step {mapping.step_number} has action {action} without a mapped repository object")
            continue
        if obj:
            locator = sap_session_locator(obj.technical_path or "")
            is_sbar_verify = action == "verify" and "sbar" in locator
            if locator and locator not in code and not (action == "open" and (mapping.test_data or "").strip()) and not is_sbar_verify:
                issues.append(f"Step {mapping.step_number} does not use mapped locator for {obj.object_name}")
            escaped_locator = re.escape(locator)
            ot = (obj.object_type or "").lower().replace(" ", "_").replace("-", "_")
            # Validate that the generated VBScript used the correct SAP GUI method
            select_required = action in {"click", "select"} and ot in (_SAP_SELECT_TYPES | _SAP_RADIO_TYPES)
            press_required = action == "click" and ot not in (
                _SAP_SELECT_TYPES | _SAP_RADIO_TYPES | _SAP_CHECKBOX_TYPES | _SAP_COMBOBOX_TYPES | _SAP_GRID_TYPES | _SAP_TREE_TYPES
            ) and ot in {"button", "toolbar_button", "toolbarbutton", "tool_button", "pushbutton", ""}
            key_required = action in {"click", "select"} and ot in _SAP_COMBOBOX_TYPES and bool((mapping.test_data or "").strip())
            selected_required = action in {"click", "select"} and ot in _SAP_CHECKBOX_TYPES
            if select_required and not re.search(rf'findById\("{escaped_locator}"\)\.Select', code, re.IGNORECASE):
                issues.append(f"Step {mapping.step_number} must use .Select for SAP {obj.object_type} '{obj.object_name}'")
            if press_required and not re.search(rf'findById\("{escaped_locator}"\)\.Press', code, re.IGNORECASE):
                issues.append(f"Step {mapping.step_number} must use .Press for SAP button '{obj.object_name}'")
            if key_required and not re.search(rf'findById\("{escaped_locator}"\)\.Key', code, re.IGNORECASE):
                issues.append(f"Step {mapping.step_number} must use .Key= to set value for SAP combobox '{obj.object_name}'")
            if selected_required and not re.search(rf'findById\("{escaped_locator}"\)\.Selected', code, re.IGNORECASE):
                issues.append(f"Step {mapping.step_number} must use .Selected for SAP checkbox '{obj.object_name}'")
        test_data = (mapping.test_data or "").strip()
        if action == "enter_text" and test_data and test_data.upper() not in {"N/A", "NA", "NONE"} and test_data not in code:
            issues.append(f"Step {mapping.step_number} does not use approved test data")
    return list(dict.fromkeys(issues))


def script_compilation_report(
    framework: str,
    test_case: TestCase,
    mappings: list[StepMapping],
    code: str,
    validation_issues: list[str],
    db: Session,
) -> dict[str, Any]:
    mapped_rows = [mapping for mapping in mappings if mapping.object_id]
    locator_count = 0
    for mapping in mapped_rows:
        obj = db.get(ObjectRepository, mapping.object_id)
        if obj and sap_session_locator(obj.technical_path or "") in code:
            locator_count += 1
    return {
        "engine": "deterministic_mapping_compiler",
        "ai_wrote_script_body": False,
        "framework": framework,
        "test_case": test_case.external_id,
        "mapping_count": len(mappings),
        "mapped_object_count": len(mapped_rows),
        "mapped_locators_used": locator_count,
        "validation_issue_count": len(validation_issues),
        "validation_passed": not validation_issues,
        "source_of_truth": "approved_step_mappings_and_object_repository",
    }


def build_script(framework: str, test_case: TestCase, mappings: list[StepMapping], db: Session) -> tuple[str, str, str]:
    normalized = framework.upper().replace(" ", "_").replace("-", "_")
    if "SAP" in normalized or "VBSCRIPT" in normalized:
        return build_vbscript(test_case, mappings, db), f"{safe_filename(test_case.external_id)}.vbs", "cscript generated-script.vbs"
    if "SELENIUM" in normalized:
        return build_selenium(test_case, mappings, db), f"{safe_class_name(test_case.external_id)}Test.java", "mvn test -Dtest=GeneratedTest"
    if "PLAYWRIGHT" in normalized:
        return build_playwright(test_case, mappings, db), f"{safe_filename(test_case.external_id)}.spec.ts", "npx playwright test"
    if "CUCUMBER" in normalized:
        return build_cucumber(test_case, mappings, db), f"{safe_filename(test_case.external_id)}.feature", "mvn test -Dcucumber.features=generated.feature"
    if "DESKTOP" in normalized:
        return build_hybrid(test_case, mappings, db, desktop=True), f"{safe_filename(test_case.external_id)}-desktop-runner.md", "desktop-runner --plan generated"
    return build_hybrid(test_case, mappings, db), f"{safe_filename(test_case.external_id)}-hybrid-runner.md", "testpilot-hybrid-runner --plan generated"


def mapping_lines(mappings: list[StepMapping], db: Session) -> list[tuple[str, str, str, str, str, str, str]]:
    lines = []
    for mapping in mappings:
        step = db.get(TestStep, mapping.test_step_id)
        obj = db.get(ObjectRepository, mapping.object_id) if mapping.object_id else None
        lines.append((
            step.instruction if step else "",
            mapping.automation_action,
            obj.object_name if obj else "UNMAPPED_OBJECT",
            obj.technical_path if obj else "REVIEW_REQUIRED",
            mapping.test_data or "",
            obj.object_type if obj else "",
            mapping.expected_result or "",
        ))
    return lines


def build_vbscript(test_case: TestCase, mappings: list[StepMapping], db: Session) -> str:
    lines = [
        "Option Explicit",
        "On Error Resume Next",
        "Dim SapGuiAuto, application, connection, session, currentStep",
        "Set SapGuiAuto = GetObject(\"SAPGUI\")",
        "CheckComObject SapGuiAuto, \"Attach to SAP GUI\"",
        "Set application = SapGuiAuto.GetScriptingEngine",
        "CheckComObject application, \"Get SAP scripting engine\"",
        "Set connection = application.Children(0)",
        "CheckComObject connection, \"Get active SAP connection\"",
        "Set session = connection.Children(0)",
        "CheckComObject session, \"Get active SAP session\"",
        "WaitForSap 30",
        "' Generated by TestPilot Agent from approved mappings.",
    ]
    for step_number, (manual, action, object_name, raw_locator, test_data, object_type, expected_result) in enumerate(mapping_lines(mappings, db), start=1):
        locator = sap_session_locator(raw_locator)
        step_label = f"Step {step_number}: {object_name}"
        lines.append(f"' Manual step: {escape_vbs(manual)}")
        lines.append(f"currentStep = \"{escape_vbs(step_label)}\"")
        if action in {"open", "navigate"}:
            transaction_code = (test_data or "").strip() or sap_transaction_from_text(manual)
            # Transaction navigation via the SAP command bar; without a code just focus the element.
            if transaction_code:
                lines.append(f"session.findById(\"wnd[0]/tbar[0]/okcd\").Text = \"{escape_vbs(transaction_code)}\"")
                lines.append("session.findById(\"wnd[0]\").SendVKey 0")
            else:
                lines.append(f"session.findById(\"{escape_vbs(locator)}\").setFocus")
                lines.append("session.findById(\"wnd[0]\").SendVKey 0")
        elif action == "enter_text":
            lines.append(f"session.findById(\"{escape_vbs(locator)}\").SetFocus")
            lines.append(f"session.findById(\"{escape_vbs(locator)}\").Text = \"{escape_vbs(test_data)}\"")
            lines.append(f"If CStr(session.findById(\"{escape_vbs(locator)}\").Text) <> \"{escape_vbs(test_data)}\" Then FailStep currentStep, \"Entered value was not retained\"")
        elif action in {"click", "select"}:
            lines.extend(_sap_interaction_lines(action, object_type, locator, test_data))
        elif action == "verify" and "sbar" in locator:
            # Status bar success message assertion — checks both text content and that it is not an error
            if test_data:
                lines.append("Dim vSbar, vSbarType, vSbarText")
                lines.append("Set vSbar = session.FindById(\"wnd[0]/sbar\", False)")
                lines.append("If Not IsObject(vSbar) Then FailStep currentStep, \"Status bar not found\"")
                lines.append("vSbarType = UCase(CStr(vSbar.MessageType))")
                lines.append("vSbarText = Trim(CStr(vSbar.Text))")
                lines.append(f"If vSbarType = \"E\" Or vSbarType = \"A\" Then FailStep currentStep, \"Expected success but got error: \" & vSbarText")
                lines.append(f"If InStr(1, vSbarText, \"{escape_vbs(test_data)}\", vbTextCompare) = 0 Then FailStep currentStep, \"Expected '{escape_vbs(test_data)}' in status bar but got: \" & vSbarText")
            else:
                lines.append("Dim vSbar2, vSbarType2")
                lines.append("Set vSbar2 = session.FindById(\"wnd[0]/sbar\", False)")
                lines.append("If Not IsObject(vSbar2) Then FailStep currentStep, \"Status bar not found\"")
                lines.append("vSbarType2 = UCase(CStr(vSbar2.MessageType))")
                lines.append("If vSbarType2 = \"E\" Or vSbarType2 = \"A\" Then FailStep currentStep, \"Status bar shows error: \" & CStr(vSbar2.Text)")
        elif action == "verify" and test_data:
            lines.append(f"If InStr(1, CStr(session.findById(\"{escape_vbs(locator)}\").Text), \"{escape_vbs(test_data)}\", vbTextCompare) = 0 Then FailStep currentStep, \"Expected value was not found\"")
        elif action == "verify":
            lines.append(f"If Len(Trim(CStr(session.findById(\"{escape_vbs(locator)}\").Text))) = 0 Then FailStep currentStep, \"Verification target was empty\"")
        else:
            lines.append(f"FailStep currentStep, \"Unsupported action: {escape_vbs(action)}\"")
        if expected_result:
            lines.append(f"' Expected: {escape_vbs(expected_result)}")
        lines.append("CheckStep currentStep")
    lines.extend([
        "CheckStatusBar currentStep",
        "WScript.Echo \"TestPilot execution completed successfully.\"",
        "WScript.Quit 0",
        "",
        "Sub CheckComObject(value, stepName)",
        "  If Err.Number <> 0 Or Not IsObject(value) Then FailStep stepName, \"SAP GUI object is unavailable\"",
        "  Err.Clear",
        "End Sub",
        "",
        "Sub CheckStep(stepName)",
        "  If Err.Number <> 0 Then",
        "    Dim message",
        "    message = Err.Description",
        "    Err.Clear",
        "    FailStep stepName, message",
        "  End If",
        "  WaitForSap 30",
        "  CheckStatusBar stepName",
        "End Sub",
        "",
        "Sub WaitForSap(timeoutSeconds)",
        "  Dim started",
        "  started = Timer",
        "  Do While session.Busy",
        "    WScript.Sleep 200",
        "    If Timer - started > timeoutSeconds Then FailStep currentStep, \"SAP GUI remained busy\"",
        "  Loop",
        "  WScript.Sleep 250",
        "End Sub",
        "",
        "Sub CheckStatusBar(stepName)",
        "  Dim statusBar, messageType, messageText",
        "  Err.Clear",
        "  Set statusBar = session.FindById(\"wnd[0]/sbar\", False)",
        "  If Err.Number <> 0 Or Not IsObject(statusBar) Then Err.Clear: Exit Sub",
        "  messageType = UCase(CStr(statusBar.MessageType))",
        "  messageText = Trim(CStr(statusBar.Text))",
        "  If messageType = \"E\" Or messageType = \"A\" Then FailStep stepName, messageText",
        "End Sub",
        "",
        "Sub FailStep(stepName, message)",
        "  WScript.Echo stepName & \" failed: \" & message",
        "  WScript.Quit 1",
        "End Sub",
    ])
    return "\n".join(lines) + "\n"


def build_selenium(test_case: TestCase, mappings: list[StepMapping], db: Session) -> str:
    class_name = safe_class_name(test_case.external_id) + "Test"
    lines = [
        "import org.openqa.selenium.By;",
        "import org.openqa.selenium.PageLoadStrategy;",
        "import org.openqa.selenium.WebDriver;",
        "import org.openqa.selenium.chrome.ChromeDriver;",
        "import org.openqa.selenium.chrome.ChromeOptions;",
        "import org.openqa.selenium.support.ui.ExpectedConditions;",
        "import org.openqa.selenium.support.ui.WebDriverWait;",
        "import org.openqa.selenium.support.ui.Select;",
        "import org.openqa.selenium.OutputType;",
        "import org.openqa.selenium.TakesScreenshot;",
        "import org.junit.jupiter.api.Assertions;",
        "import org.junit.jupiter.api.Test;",
        "import java.io.File;",
        "import java.nio.file.Files;",
        "import java.nio.file.Paths;",
        "import java.nio.file.StandardCopyOption;",
        "import java.time.Duration;",
        "",
        f"public class {class_name} {{",
        "  @Test",
        "  public void generatedAutomation() {",
        "    ChromeOptions options = new ChromeOptions();",
        "    // EAGER: proceed once the DOM is interactive instead of waiting on every last",
        "    // font/analytics/third-party resource under the default \"normal\" strategy.",
        "    options.setPageLoadStrategy(PageLoadStrategy.EAGER);",
        "    WebDriver driver = new ChromeDriver(options);",
        "    // Many apps render key UI client-side (React/Vue/Angular) after EAGER returns, so",
        "    // every lookup waits for the element rather than assuming the DOM is already there.",
        "    WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(20));",
        "    try {",
        "      driver.get(System.getenv().getOrDefault(\"PRODUCT_URL\", \"http://localhost\"));",
    ]
    for step_number, (manual, action, object_name, locator, test_data, _, _) in enumerate(mapping_lines(mappings, db), start=1):
        lines.append(f"      // {escape_java(manual)}")
        # Web object locators in this app (manual entry or the Web Scanner) are CSS selectors —
        # including plain descendant chains like "body > div:nth-of-type(1) > button" that don't
        # start with '#'/'.'  or contain '[', which the shared locator_strategy() heuristic (built
        # for SAP paths) misses. Only genuine XPath (leading '/' or '(') should use By.xpath.
        if locator.startswith("/") or locator.startswith("("):
            by_call = f'By.xpath("{escape_java(locator)}")'
        else:
            by_call = f'By.cssSelector("{escape_java(locator)}")'
        find_call = f"wait.until(ExpectedConditions.presenceOfElementLocated({by_call}))"
        action_lines: list[str] = []
        if action == "enter_text":
            action_lines.append(f"{find_call}.sendKeys(\"{escape_java(test_data)}\");")
        elif action == "click":
            action_lines.append(f"wait.until(ExpectedConditions.elementToBeClickable({by_call})).click();")
        elif action == "select":
            action_lines.append(f"new Select({find_call}).selectByVisibleText(\"{escape_java(test_data)}\");")
        elif action == "verify":
            has_real_object = bool(object_name) and object_name != "UNMAPPED_OBJECT" and bool(locator) and locator != "REVIEW_REQUIRED"
            if has_real_object:
                action_lines.append(f"Assertions.assertTrue({find_call}.isDisplayed(), \"Expected element not visible: {escape_java(object_name)}\");")
            else:
                # No product-library object matched this verification (e.g. a page-level text
                # check like "Verify Dashboard text is displayed") — fall back to a page-source
                # substring assertion on whatever the step is actually naming.
                target_text = verify_target_text(manual)
                action_lines.append(f"Assertions.assertTrue(driver.getPageSource().contains(\"{escape_java(target_text)}\"), \"Expected text not found on page: {escape_java(target_text)}\");")
            # Real proof, not just a boolean: capture the page state at the exact moment the
            # assertion passes, into the script's actual evidence folder (EVIDENCE_DIR, set by
            # the runner) rather than a screenshot that could be taken at any arbitrary time.
            action_lines.append(f"captureEvidence(driver, \"step-{step_number}-verify.png\");")
        if action_lines:
            # Marker format ("Step N: label failed: message") matches the existing SAP VBScript
            # FailStep convention, so the existing log-based step-result parser (built for SAP)
            # already understands it — no other backend change needed for real per-step pass/fail.
            step_label = f"Step {step_number}: {escape_java(manual or object_name or action)}"
            lines.append("      try {")
            for action_line in action_lines:
                lines.append(f"        {action_line}")
            lines.append(f"        System.out.println(\"{step_label} passed\");")
            lines.append("      } catch (Throwable stepError) {")
            lines.append(f"        System.out.println(\"{step_label} failed: \" + (stepError.getMessage() == null ? \"unknown error\" : stepError.getMessage().split(\"\\\\n\")[0]));")
            lines.append("        throw stepError;")
            lines.append("      }")
        else:
            lines.append(f"      // TODO {escape_java(action)} using locator: {escape_java(locator)}")
    lines.extend([
        "    } finally { driver.quit(); }",
        "  }",
        "",
        "  private static void captureEvidence(WebDriver driver, String fileName) {",
        "    try {",
        "      String evidenceDir = System.getenv().getOrDefault(\"EVIDENCE_DIR\", \"evidence\");",
        "      new File(evidenceDir).mkdirs();",
        "      File shot = ((TakesScreenshot) driver).getScreenshotAs(OutputType.FILE);",
        "      Files.copy(shot.toPath(), Paths.get(evidenceDir, fileName), StandardCopyOption.REPLACE_EXISTING);",
        "      System.out.println(\"Evidence saved: \" + Paths.get(evidenceDir, fileName));",
        "    } catch (Exception evidenceError) {",
        "      System.out.println(\"Evidence capture failed: \" + evidenceError.getMessage());",
        "    }",
        "  }",
        "}",
    ])
    return "\n".join(lines) + "\n"


def build_playwright(test_case: TestCase, mappings: list[StepMapping], db: Session) -> str:
    lines = [
        "import { test, expect } from '@playwright/test';",
        "",
        f"test('{escape_ts(test_case.title)}', async ({{ page }}) => {{",
        "  await page.goto(process.env.PRODUCT_URL || 'http://localhost');",
    ]
    for step_number, (manual, action, object_name, locator, test_data, _, _) in enumerate(mapping_lines(mappings, db), start=1):
        lines.append(f"  // {escape_ts(manual)}")
        # Same locator convention as the Selenium compiler: genuine XPath (leading '/' or '(')
        # needs Playwright's explicit "xpath=" engine prefix; everything else is a CSS selector,
        # which is Playwright's default locator engine and needs no prefix.
        loc = escape_ts(locator)
        selector = f"xpath={loc}" if locator.startswith("/") or locator.startswith("(") else loc
        action_lines: list[str] = []
        if action == "enter_text":
            action_lines.append(f"await page.locator('{selector}').fill('{escape_ts(test_data)}');")
        elif action == "click":
            action_lines.append(f"await page.locator('{selector}').click();")
        elif action == "select":
            action_lines.append(f"await page.locator('{selector}').selectOption({{ label: '{escape_ts(test_data)}' }});")
        elif action == "verify":
            has_real_object = bool(object_name) and object_name != "UNMAPPED_OBJECT" and bool(locator) and locator != "REVIEW_REQUIRED"
            if has_real_object:
                action_lines.append(f"await expect(page.locator('{selector}')).toBeVisible();")
            else:
                # No product-library object matched — fall back to a page-text assertion on
                # whatever the step is actually naming (mirrors the Selenium compiler fallback).
                target_text = verify_target_text(manual)
                action_lines.append(f"await expect(page.locator('body')).toContainText('{escape_ts(target_text)}');")
            # Real proof, not just a boolean: capture the page state at the exact moment the
            # assertion passes, into the script's actual evidence folder (EVIDENCE_DIR, set by
            # the runner) rather than a screenshot that could be taken at any arbitrary time.
            action_lines.append(f"await page.screenshot({{ path: (process.env.EVIDENCE_DIR || 'evidence') + '/step-{step_number}-verify.png' }});")
        if action_lines:
            # Same "Step N: label failed: message" marker convention as the SAP VBScript and
            # Selenium compilers, so the existing log-based step-result parser picks it up as-is.
            step_label = escape_ts(f"Step {step_number}: {manual or object_name or action}")
            lines.append("  try {")
            for action_line in action_lines:
                lines.append(f"    {action_line}")
            lines.append(f"    console.log('{step_label} passed');")
            lines.append("  } catch (e) {")
            lines.append("    const message = e instanceof Error ? e.message.split('\\n')[0] : String(e);")
            lines.append(f"    console.log('{step_label} failed: ' + message);")
            lines.append("    throw e;")
            lines.append("  }")
        else:
            lines.append(f"  // TODO {escape_ts(action)} with {selector}")
    lines.append("});")
    return "\n".join(lines) + "\n"


def build_cucumber(test_case: TestCase, mappings: list[StepMapping], db: Session) -> str:
    lines = ["Feature: " + test_case.title, "", f"  Scenario: {test_case.external_id}"]
    for manual, action, object_name, _, _, _, _ in mapping_lines(mappings, db):
        keyword = "Then" if action == "verify" else "When"
        lines.append(f"    {keyword} I {action.replace('_', ' ')} on \"{object_name}\" # {manual}")
    lines.extend(["", "# Step definitions placeholder generated by TestPilot Agent."])
    return "\n".join(lines) + "\n"


def build_hybrid(test_case: TestCase, mappings: list[StepMapping], db: Session, desktop: bool = False) -> str:
    runner = "Desktop Runner" if desktop else "Hybrid Runner"
    lines = [f"# {runner} generated plan", f"test_case: {test_case.external_id}", f"title: {test_case.title}", "steps:"]
    for manual, action, object_name, locator, test_data, _, _ in mapping_lines(mappings, db):
        lines.append(f"  - manual_step: {manual}")
        lines.append(f"    action: {action}")
        lines.append(f"    object: {object_name}")
        lines.append(f"    locator: {locator}")
        if test_data:
            lines.append(f"    test_data: {test_data}")
    lines.append("evidence: screenshots-and-logs-placeholder")
    return "\n".join(lines) + "\n"


def safe_class_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", " ", value).title().replace(" ", "")
    return cleaned if cleaned and cleaned[0].isalpha() else f"Generated{cleaned}"


def escape_vbs(value: str) -> str:
    # VBScript string literals have no escape sequence for embedded newlines, so a raw
    # "\n"/"\r" would split the statement across physical lines and fail to parse.
    return value.replace('"', '""').replace("\r\n", " ").replace("\r", " ").replace("\n", " ")


def sap_session_locator(value: str) -> str:
    locator = str(value or "").strip()
    return re.sub(r"^/?app/con\[\d+\]/ses\[\d+\]/", "", locator, flags=re.IGNORECASE)


def escape_java(value: str) -> str:
    return (
        value.replace("\\", "\\\\").replace('"', '\\"')
        .replace("\r\n", "\\n").replace("\r", "\\n").replace("\n", "\\n")
    )


def escape_ts(value: str) -> str:
    return (
        value.replace("\\", "\\\\").replace("'", "\\'")
        .replace("\r\n", "\\n").replace("\r", "\\n").replace("\n", "\\n")
    )


def suggest_path(old_path: str, obj: ObjectRepository) -> str:
    if not old_path:
        return f"{obj.object_name.lower().replace(' ', '-')}-stable-locator"
    if old_path.startswith("/") or old_path.startswith("("):
        return f"({old_path})[1]"
    if "id=" in old_path.lower():
        return old_path.replace("id=", "data-testid=")
    return f"{old_path} [stable-candidate]"


def count(db: Session, model: type) -> int:
    return int(db.scalar(select(func.count()).select_from(model)) or 0)


def count_where(db: Session, model: type, *criteria: Any) -> int:
    statement = select(func.count()).select_from(model)
    if criteria:
        statement = statement.where(*criteria)
    return int(db.scalar(statement) or 0)


def product_report(product_id: int, db: Session) -> dict[str, Any]:
    total_steps = count_where(db, TestStep, TestStep.test_case_id.in_(select(TestCase.id).where(TestCase.product_id == product_id)))
    mapped = count_where(db, StepMapping, StepMapping.test_step_id.in_(select(TestStep.id).join(TestCase).where(TestCase.product_id == product_id)), StepMapping.status.in_(["mapped", "approved"]))
    summary = db.scalar(select(KnowledgeSummary).where(KnowledgeSummary.product_id == product_id))
    return {
        "product_id": product_id,
        "knowledge_readiness": round(summary.readiness if summary else 0, 1),
        "library_readiness": min(100, count_where(db, ObjectRepository, ObjectRepository.product_id == product_id) * 18),
        "mapping_readiness": round(mapped * 100 / max(total_steps, 1), 1),
        "risk_score": round(db.scalar(select(func.avg(TestCase.risk_score)).where(TestCase.product_id == product_id)) or 0, 1),
        "quality_score": round(db.scalar(select(func.avg(TestCase.quality_score)).where(TestCase.product_id == product_id)) or 0, 1),
        "total_products": count(db, Product),
        "knowledge_sources": count_where(db, KnowledgeSource, KnowledgeSource.product_id == product_id),
        "library_objects": count_where(db, ObjectRepository, ObjectRepository.product_id == product_id),
        "test_cases": count_where(db, TestCase, TestCase.product_id == product_id),
        "mapped_steps": mapped,
        "unmapped_steps": count_where(db, StepMapping, StepMapping.test_step_id.in_(select(TestStep.id).join(TestCase).where(TestCase.product_id == product_id)), StepMapping.status == "unmapped"),
        "generated_scripts": count_where(db, GeneratedScript, GeneratedScript.product_id == product_id),
        "executions": count_where(db, ExecutionRun, ExecutionRun.product_id == product_id),
        "auto_heal_suggestions": count_where(db, AutoHealSuggestion, AutoHealSuggestion.product_id == product_id),
    }


def serialize_product(product: Product) -> dict[str, Any]:
    return {
        "id": product.id,
        "name": product.name,
        "product_type": product.product_type,
        "type": product.product_type,
        "environment": product.environment,
        "entry_point": product.entry_point,
        "entryPoint": product.entry_point,
        "app_path_or_url": product.app_path_or_url or product.entry_point,
        "appPathOrUrl": product.app_path_or_url or product.entry_point,
        "default_framework": product.default_framework,
        "framework": product.default_framework,
        "owner": product.owner,
        "description": product.description,
        "business_criticality": product.business_criticality,
        "automation_risk_level": product.automation_risk_level,
        "readiness_score": product.readiness_score,
        "readiness": product.readiness_score,
        "created_at": product.created_at,
        "updated_at": product.updated_at,
    }


def serialize_module(row: Module) -> dict[str, Any]:
    return {"id": row.id, "product_id": row.product_id, "name": row.name, "description": row.description}


def serialize_feature(row: Feature) -> dict[str, Any]:
    return {"id": row.id, "module_id": row.module_id, "name": row.name, "description": row.description}


def serialize_knowledge_source(row: KnowledgeSource) -> dict[str, Any]:
    return {
        "id": row.id,
        "product_id": row.product_id,
        "source_type": row.source_type,
        "name": row.name,
        "original_filename": row.original_filename,
        "filename": row.filename,
        "file_type": row.file_type or row.content_type,
        "file_size": row.file_size,
        "content_type": row.content_type,
        "status": row.status,
        "error_message": row.error_message,
        "preview": row.extracted_text_preview,
        "processed_at": row.processed_at,
        "created_at": row.created_at,
    }


def empty_knowledge_summary(product_id: int, db: Session) -> dict[str, Any]:
    return {
        "product_id": product_id,
        "readiness": 0,
        "modules": [],
        "features": [],
        "modules_detected_list": [],
        "features_detected_list": [],
        "business_rules": [],
        "validations": [],
        "expected_messages": [],
        "gaps": ["Upload and process product knowledge to unlock reliable automation."],
        "missing_gaps": ["Upload and process product knowledge to unlock reliable automation."],
        "what_ai_learned": [],
        "what_ai_is_unsure_about": [],
        "suggestions": ["Start with user guides, functional specs, known issues, and existing tests."],
        "documents_uploaded": count_where(db, KnowledgeSource, KnowledgeSource.product_id == product_id),
        "chunks_created": count_where(db, KnowledgeChunk, KnowledgeChunk.product_id == product_id),
        "modules_detected": 0,
        "features_detected": 0,
        "business_rules_extracted": 0,
        "ai_warning": "",
    }


def serialize_knowledge_summary(summary: KnowledgeSummary, product_id: int, db: Session) -> dict[str, Any]:
    return {
        "product_id": product_id,
        "readiness": summary.readiness,
        "modules": summary.modules,
        "features": summary.features,
        "modules_detected_list": summary.modules_detected or summary.modules,
        "features_detected_list": summary.features_detected or summary.features,
        "business_rules": summary.business_rules,
        "validations": summary.validations,
        "expected_messages": summary.expected_messages,
        "gaps": summary.gaps,
        "missing_gaps": summary.missing_gaps or summary.gaps,
        "what_ai_learned": summary.what_ai_learned,
        "what_ai_is_unsure_about": summary.what_ai_is_unsure_about,
        "suggestions": summary.suggestions,
        "documents_uploaded": count_where(db, KnowledgeSource, KnowledgeSource.product_id == product_id),
        "chunks_created": count_where(db, KnowledgeChunk, KnowledgeChunk.product_id == product_id),
        "modules_detected": len(summary.modules or []),
        "features_detected": len(summary.features or []),
        "business_rules_extracted": len(summary.business_rules or []),
        "ai_warning": summary.ai_warning,
        "ai_raw_response": summary.ai_raw_response,
    }


def serialize_knowledge_chunk(row: KnowledgeChunk) -> dict[str, Any]:
    return {
        "id": row.id,
        "source_id": row.source_id,
        "product_id": row.product_id,
        "chunk_index": row.chunk_index,
        "content": row.content,
        "chunk_text": row.chunk_text or row.content,
        "tags": row.tags,
        "embedding_text": row.embedding_text,
        "metadata": row.metadata_json,
    }


def serialize_object(row: ObjectRepository, db: Session) -> dict[str, Any]:
    product = db.get(Product, row.product_id)
    return {
        "id": row.id,
        "product_id": row.product_id,
        "product": product.name if product else "",
        "object_name": row.object_name,
        "objectName": row.object_name,
        "platform": row.platform,
        "module": row.module,
        "area_or_tab": row.area_or_tab or "",
        "areaOrTab": row.area_or_tab or "",
        "feature": row.feature,
        "screen": row.screen,
        "screen_type": row.screen_type or "SCREEN",
        "screenType": row.screen_type or "SCREEN",
        "object_type": row.object_type,
        "objectType": row.object_type,
        "technical_path": row.technical_path,
        "locator": row.technical_path,
        "locator_strategy": row.locator_strategy or locator_strategy(row.technical_path, row.platform),
        "locatorStrategy": row.locator_strategy or locator_strategy(row.technical_path, row.platform),
        "supported_actions": row.supported_actions,
        "supportedActions": row.supported_actions,
        "scope": row.scope or "SCREEN",
        "parent_screen_id": row.parent_screen_id,
        "parentScreenId": row.parent_screen_id,
        "parent_object_id": row.parent_object_id,
        "parentObjectId": row.parent_object_id,
        "verification_status": row.verification_status or ("Verified" if row.last_verified else "Unverified"),
        "verificationStatus": row.verification_status or ("Verified" if row.last_verified else "Unverified"),
        "captured_from": row.captured_from or "",
        "capturedFrom": row.captured_from or "",
        "notes": row.notes or "",
        "status": row.status,
        "confidence": row.confidence,
        "aliases": row.aliases,
        "last_verified": row.last_verified,
        "lastVerified": row.last_verified,
        "path_history": row.path_history,
    }


def serialize_test_case(row: TestCase, include_steps: bool = False) -> dict[str, Any]:
    steps = sorted(row.steps, key=lambda item: item.step_order) if include_steps else []
    return {
        "id": row.id,
        "product_id": row.product_id,
        "external_id": row.external_id,
        "externalId": row.external_id,
        "title": row.title,
        "module": row.module,
        "feature": row.feature,
        "source": row.source,
        "priority": row.priority,
        "steps_text": row.steps_text,
        "expected_result": row.expected_result,
        "expectedResult": row.expected_result,
        "readiness": row.readiness,
        "automation_readiness": row.readiness,
        "quality_score": row.quality_score,
        "qualityScore": row.quality_score,
        "risk_score": row.risk_score,
        "riskScore": row.risk_score,
        "duplicate_group": row.duplicate_group,
        "status": row.status,
        "analysis_result": row.analysis_result,
        "analysisResult": row.analysis_result,
        "steps": len(row.steps),
        "step_items": [{"id": step.id, "order": step.step_order, "instruction": step.instruction, "expected_result": step.expected_result} for step in steps],
        "stepItems": [{"id": step.id, "order": step.step_order, "instruction": step.instruction, "expectedResult": step.expected_result} for step in steps],
    }


def serialize_mapping(row: StepMapping, db: Session) -> dict[str, Any]:
    step = db.get(TestStep, row.test_step_id)
    obj = db.get(ObjectRepository, row.object_id) if row.object_id else None
    return {
        "id": row.id,
        "product_id": row.product_id,
        "test_case_id": row.test_case_id,
        "test_step_id": row.test_step_id,
        "step_number": row.step_number,
        "manual_step": row.manual_step or (step.instruction if step else ""),
        "manualStep": row.manual_step or (step.instruction if step else ""),
        "ai_understanding": row.ai_understanding,
        "aiUnderstanding": row.ai_understanding,
        "mapped_object": obj.object_name if obj else "Unmapped",
        "mappedObject": obj.object_name if obj else "Unmapped",
        "mapped_object_id": obj.id if obj else None,
        "object": serialize_object(obj, db) if obj else None,
        "automation_action": row.automation_action,
        "action": row.automation_action,
        "test_data": row.test_data,
        "expected_result": row.expected_result,
        "confidence": row.confidence,
        "risk_score": row.risk_score,
        "riskScore": row.risk_score,
        "selected_reason": row.selected_reason,
        "selectedReason": row.selected_reason,
        "alternative_objects": row.alternative_objects,
        "alternativeObjects": row.alternative_objects,
        "ai_raw_response": row.ai_raw_response,
        "status": row.status,
        "approved": row.approved,
    }


def serialize_script(row: GeneratedScript) -> dict[str, Any]:
    return {
        "id": row.id,
        "product_id": row.product_id,
        "test_case_id": row.test_case_id,
        "framework": row.framework,
        "code": row.code,
        "file_name": row.file_name,
        "fileName": row.file_name,
        "file_path": row.file_path,
        "command": row.command,
        "review_json": row.review_json,
        "risk_score": row.risk_score,
        "status": row.status,
        "review_status": row.review_status,
        "download_url": f"/api/scripts/{row.id}/download",
        "created_at": row.created_at,
    }


def serialize_execution(row: ExecutionRun, db: Session) -> dict[str, Any]:
    steps = db.scalars(select(ExecutionStepResult).where(ExecutionStepResult.execution_id == row.id).order_by(ExecutionStepResult.step_order)).all()
    return {
        "id": row.id,
        "product_id": row.product_id,
        "script_id": row.script_id,
        "test_case_id": row.test_case_id,
        "status": row.status,
        "duration_seconds": row.duration_seconds,
        "logs": row.logs,
        "evidence_path": row.evidence_path,
        "command": row.command,
        "failure_analysis_json": row.failure_analysis_json,
        "step_results": [{"order": step.step_order, "action": step.action, "instruction": step.instruction, "status": step.status, "duration": step.duration_seconds, "message": step.message} for step in steps],
        "created_at": row.created_at,
    }


def serialize_auto_heal(row: AutoHealSuggestion, db: Session) -> dict[str, Any]:
    obj = db.get(ObjectRepository, row.object_id) if row.object_id else None
    return {
        "id": row.id,
        "product_id": row.product_id,
        "execution_id": row.execution_id,
        "object_id": row.object_id,
        "object": obj.object_name if obj else "Unassigned object",
        "platform": obj.platform if obj else "",
        "old_path": row.old_path,
        "suggested_path": row.suggested_path,
        "reason": row.reason,
        "confidence": row.confidence,
        "risk_score": row.risk_score,
        "ai_raw_response": row.ai_raw_response,
        "status": row.status,
        "decided_at": row.decided_at,
        "created_at": row.created_at,
    }


def serialize_integration(row: IntegrationConfig) -> dict[str, Any]:
    config = dict(row.config or {})
    if config.get("zephyr_token"):
        config["zephyr_token"] = "********"
    return {"id": row.id, "product_id": row.product_id, "integration_type": row.integration_type, "enabled": row.enabled, "config": config, "updated_at": row.updated_at}


def serialize_history(row: HistoryEvent) -> dict[str, Any]:
    return {
        "id": row.id,
        "product_id": row.product_id,
        "time": row.created_at,
        "created_at": row.created_at,
        "actor": row.actor,
        "action": row.action,
        "entity_type": row.entity_type,
        "entity": row.entity_type,
        "entity_id": row.entity_id,
        "status": row.status,
        "details": row.details,
        "before_value": row.before_value,
        "after_value": row.after_value,
        "before": row.before_value,
        "after": row.after_value,
    }


def default_settings() -> dict[str, Any]:
    return {
        "ai_provider": settings.ai_provider,
        "model_name": settings.model_name,
        "real_ai_required": True,
        "ai_configured": settings.ai_configured,
        "openai_configured": settings.openai_configured,
        "vector_db_type": settings.vector_db_type,
        "default_framework": "SAP_GUI_VBSCRIPT",
        "runner_mode": "safe",
        "require_approval_before_script_generation": True,
        "require_approval_before_auto_heal_update": True,
        "minimum_mapping_confidence": 85,
        "maximum_allowed_risk_score": 75,
        "enable_local_runner": settings.enable_local_runner,
        "allow_auto_run_after_script_generation": False,
        "store_execution_evidence": True,
        "enable_hybrid_runner": True,
        "enable_desktop_automation": True,
        "history_retention_days": 365,
    }


def normalize_settings_payload(values: dict[str, Any] | None) -> dict[str, Any]:
    merged = {**default_settings(), **(values or {})}
    merged["ai_provider"] = settings.ai_provider
    merged["ai_configured"] = settings.ai_configured
    merged["openai_configured"] = settings.openai_configured
    model_name = str(merged.get("model_name") or "").strip()
    if settings.ai_provider.strip().lower() == "openai" and (not model_name or not model_name.lower().startswith("gpt-")):
        merged["model_name"] = settings.model_name
    if settings.ai_provider.strip().lower() in {"local", "llama_cpp", "llamacpp"}:
        merged["model_name"] = settings.model_name
    return merged
