export class AutomationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 500,
  ) {
    super(message);
    this.name = 'AutomationError';
  }
}

export class LoginInvalidError extends AutomationError {
  constructor(message = 'Login invalid or rejected by the application.') {
    super(message, 'LOGIN_INVALID', 401);
  }
}

export class SessionExpiredError extends AutomationError {
  constructor(message = 'Session expired or application redirected to login.') {
    super(message, 'SESSION_EXPIRED', 401);
  }
}

export class LayoutChangedError extends AutomationError {
  constructor(message = 'Expected selector was not found. The page layout may have changed.') {
    super(message, 'LAYOUT_CHANGED', 422);
  }
}

export class QrNotFoundError extends AutomationError {
  constructor(message = 'QR Code was not found in captured network responses.') {
    super(message, 'QR_NOT_FOUND', 504);
  }
}

export class ResponseTimeoutError extends AutomationError {
  constructor(message = 'Timed out while waiting for the QR Code network response.') {
    super(message, 'RESPONSE_TIMEOUT', 504);
  }
}

export class EndpointNotFoundError extends AutomationError {
  constructor(message = 'Expected QR endpoint was not found.') {
    super(message, 'ENDPOINT_NOT_FOUND', 504);
  }
}
