import axios from 'axios';
import { clearSession, loadSession, saveSession } from './auth-storage';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

apiClient.interceptors.request.use((config) => {
  const session = loadSession();
  if (session?.accessToken) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return config;
});

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const session = loadSession();
  if (!session?.refreshToken) return null;
  try {
    const res = await axios.post(`${API_BASE_URL}/auth/refresh`, {
      refreshToken: session.refreshToken,
    });
    saveSession(res.data);
    return res.data.accessToken as string;
  } catch {
    clearSession();
    return null;
  }
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      if (!refreshInFlight) {
        refreshInFlight = refreshAccessToken().finally(() => {
          refreshInFlight = null;
        });
      }
      const newAccessToken = await refreshInFlight;
      if (newAccessToken) {
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return apiClient(originalRequest);
      }
      // Refresh itself failed (expired/already-rotated refresh token) —
      // clearSession() already ran inside refreshAccessToken(), but that only
      // clears storage; it can't reach into AuthContext's in-memory user
      // state from here. Without this, the app keeps rendering as if still
      // logged in while every subsequent request silently 401s (confirmed
      // live: a real session died mid-use and every action afterward just
      // showed a bare "Unauthorized" toast with no signal to log back in).
      if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        window.location.href = '/';
      }
    }
    return Promise.reject(error);
  },
);
