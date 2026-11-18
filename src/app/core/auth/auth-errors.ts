/** Komunikaty błędów Neon Auth (Better Auth) po polsku – po kodzie błędu, z bezpiecznym domyślnym tekstem */
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Nieprawidłowy email lub hasło.',
  INVALID_PASSWORD: 'Nieprawidłowe hasło.',
  INVALID_EMAIL: 'Nieprawidłowy adres email.',
  USER_ALREADY_EXISTS: 'Konto z tym adresem email już istnieje. Zaloguj się albo odzyskaj hasło.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Konto z tym adresem email już istnieje. Zaloguj się albo odzyskaj hasło.',
  EMAIL_NOT_VERIFIED: 'Adres email nie został jeszcze potwierdzony.',
  PASSWORD_TOO_SHORT: 'Hasło jest za krótkie.',
  PASSWORD_TOO_LONG: 'Hasło jest za długie.',
  INVALID_OTP: 'Nieprawidłowy kod.',
  OTP_EXPIRED: 'Kod wygasł – wyślij nowy.',
  TOO_MANY_ATTEMPTS: 'Za dużo prób. Wyślij nowy kod.',
  INVALID_TOKEN: 'Link jest nieprawidłowy lub wygasł. Poproś o nowy.',
  TOKEN_EXPIRED: 'Link wygasł. Poproś o nowy.',
  USER_NOT_FOUND: 'Nie znaleziono konta.',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'To konto nie ma hasła.',
  SESSION_EXPIRED: 'Sesja wygasła – zaloguj się ponownie.',
  FAILED_TO_CREATE_USER: 'Nie udało się utworzyć konta.',
  INVALID_ORIGIN: 'Ta domena nie jest dodana do zaufanych w Neon Auth (Auth → Configuration → Domains).',
};

export interface AuthFailure {
  code: string | null;
  status: number | null;
  message: string;
}

export function toAuthFailure(e: unknown): AuthFailure {
  const o = (e ?? {}) as { code?: unknown; status?: unknown; message?: unknown; statusText?: unknown; body?: { code?: unknown; message?: unknown } };
  const code = typeof o.code === 'string' ? o.code : typeof o.body?.code === 'string' ? o.body.code : null;
  const status = typeof o.status === 'number' ? o.status : null;
  const raw = typeof o.message === 'string' ? o.message : typeof o.body?.message === 'string' ? o.body.message : '';
  if (code && MESSAGES[code]) return { code, status, message: MESSAGES[code] };
  if (status === 429) return { code, status, message: 'Za dużo prób w krótkim czasie. Spróbuj ponownie za chwilę.' };
  if (e instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(raw)) {
    return { code: 'NETWORK', status, message: 'Brak połączenia z serwerem logowania. Sprawdź internet.' };
  }
  return { code, status, message: raw || 'Wystąpił nieoczekiwany błąd. Spróbuj ponownie.' };
}
