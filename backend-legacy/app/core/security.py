import hmac

from fastapi import Header, HTTPException, status

from app.core.config import settings


async def require_api_key(x_api_key: str = Header(default="")) -> None:
    """Gate every API route behind a shared secret when API_AUTH_TOKEN is configured.

    Left as a no-op when API_AUTH_TOKEN is unset, so local development (no token
    configured anywhere) keeps working exactly as before. Any deployment that sets
    the token (e.g. docker-compose exposing the port beyond localhost) is protected.
    """
    if not settings.api_auth_token:
        return
    if not hmac.compare_digest(x_api_key or "", settings.api_auth_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing API key")
