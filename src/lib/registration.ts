// Registration rules, in one place so the form, the tests and the copy agree.
//
// The backend enforces the same rules (backend/app/models.py SignupBody and
// main.py /api/auth/signup); this module exists to explain a problem *before* a
// round trip, not to replace that enforcement.
import { MIN_AGE } from "./legal";

export const MIN_PASSWORD_LENGTH = 8;

export interface RegistrationInput {
  email: string;
  password: string;
  confirm: string;
  ageConfirmed: boolean;
  termsAccepted: boolean;
}

/** Why this password is not acceptable yet, or "" when it is. */
export function passwordProblem(password: string): string {
  if (!password) return "";
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Include at least one letter and one digit.";
  }
  return "";
}

export function confirmProblem(password: string, confirm: string): string {
  if (!confirm) return "";
  return confirm === password ? "" : "Passwords do not match.";
}

/** A loose email check — enough to catch a typo, not to be the final word. */
export function emailProblem(email: string): string {
  const value = email.trim();
  if (!value) return "";
  return /^[^@\s]+@[^@\s.]+\.[^@\s.]{2,}$/.test(value)
    ? ""
    : "That does not look like an email address.";
}

/**
 * The first thing standing between this form and a request, or null when the
 * account may be created. Legal acceptances come last on purpose: they are the
 * gate, and telling someone their password is short is more useful than telling
 * them they have not ticked a box yet.
 */
export function registrationProblem(input: RegistrationInput): string | null {
  const email = emailProblem(input.email);
  if (input.email.trim() && email) return email;
  if (!input.email.trim()) return "Enter your email address.";
  if (!input.password) return "Choose a password.";
  const password = passwordProblem(input.password);
  if (password) return password;
  const confirm = confirmProblem(input.password, input.confirm);
  if (confirm) return confirm;
  if (!input.ageConfirmed) return `Confirm that you are ${MIN_AGE} or older to create an account.`;
  if (!input.termsAccepted) {
    return "Accept the Terms and Privacy Policy to create an account.";
  }
  return null;
}
