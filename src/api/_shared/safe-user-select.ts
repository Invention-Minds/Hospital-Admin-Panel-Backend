/**
 * Staff-account fields that are safe to send to the browser when a query
 * includes the related User (e.g. "booked by" on an appointment).
 *
 * Use `include: { user: { select: SAFE_USER_SELECT } }`, never `user: true`:
 * a full User row carries the bcrypt password hash, the encrypted
 * authenticator secret and staff personal data (email, phone, DOB).
 */
export const SAFE_USER_SELECT = {
  id: true,
  username: true,
  fullName: true,
  role: true,
  adminType: true,
  subAdminType: true,
  employeeId: true,
  department: true,
  designation: true,
  isReceptionist: true,
  isActive: true,
} as const;
