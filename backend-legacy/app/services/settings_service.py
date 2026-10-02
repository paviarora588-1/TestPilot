from app.services.store import store


class SettingsService:
    def get(self):
        return store.settings

    def update(self, payload: dict):
        store.settings.update(payload.get("settings", payload))
        return store.settings
