import type { AdminRoast, AdminUser, AdminUserUpdate } from './admin';

/** A pending switch toggle on the users table, awaiting confirmation. */
export interface PendingUserChange {
  user: AdminUser;
  field: keyof Required<AdminUserUpdate>;
  value: boolean;
}

/** A pending roast deletion, awaiting confirmation. */
export interface PendingRoastDelete {
  roast: AdminRoast;
}
