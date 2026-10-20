import api from './api';
import type { Paginated } from '../types/admin';
import type { Roast, RoastCreate, RoastQuota, RoastStatusResponse } from '../types/roast';

export interface ListRoastsParams {
  page?: number;
  size?: number;
}

/** POST /roasts → 202 with the queued roast. */
export const createRoast = async (payload: RoastCreate): Promise<Roast> => {
  const { data } = await api.post<Roast>('/roasts', payload);
  return data;
};

/** GET /roasts/quota → roasts left in the rolling 24-hour window. */
export const getRoastQuota = async (): Promise<RoastQuota> => {
  const { data } = await api.get<RoastQuota>('/roasts/quota');
  return data;
};

/** GET /roasts/{id} → full owner view. */
export const getRoast = async (id: number | string): Promise<Roast> => {
  const { data } = await api.get<Roast>(`/roasts/${id}`);
  return data;
};

/** GET /roasts/{id}/status → lightweight status for polling. */
export const getRoastStatus = async (id: number | string): Promise<RoastStatusResponse> => {
  const { data } = await api.get<RoastStatusResponse>(`/roasts/${id}/status`);
  return data;
};

/** POST /roasts/{id}/retry → 202, only valid for failed roasts. */
export const retryRoast = async (id: number | string): Promise<Roast> => {
  const { data } = await api.post<Roast>(`/roasts/${id}/retry`);
  return data;
};

/** DELETE /roasts/{id} → 204. */
export const deleteRoast = async (id: number | string): Promise<void> => {
  await api.delete(`/roasts/${id}`);
};

/** GET /roasts?page=&size= → the current user's roasts, newest first. */
export const listRoasts = async ({ page = 1, size = 10 }: ListRoastsParams = {}): Promise<Paginated<Roast>> => {
  const { data } = await api.get<Paginated<Roast>>('/roasts', { params: { page, size } });
  return data;
};
