import type { Timestamp } from "firebase/firestore";

export type UserStatus = "active" | "disabled";

export interface AppUser {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  photoURL?: string | null;
  status: UserStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastLoginAt?: Timestamp;
}
