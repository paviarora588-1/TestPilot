from fastapi import APIRouter, Depends

from app.api.endpoints import router as endpoints_router
from app.core.security import require_api_key

api_router = APIRouter(dependencies=[Depends(require_api_key)])
api_router.include_router(endpoints_router)
