export class VeilError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VeilError";
  }
}

export class NoPrivacyRouteError extends VeilError {
  constructor(message = "This privacy route is temporarily unavailable.") {
    super("NO_HEALTHY_PRIVACY_ROUTE", message);
    this.name = "NoPrivacyRouteError";
  }
}

export class RouteIntegrityError extends VeilError {
  constructor(message = "Route plan integrity verification failed.") {
    super("ROUTE_INTEGRITY_FAILED", message);
    this.name = "RouteIntegrityError";
  }
}

export class HardwareApprovalError extends VeilError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "HardwareApprovalError";
  }
}

export class PrivacyDowngradeError extends VeilError {
  constructor(message = "Execution privacy is weaker than the approved privacy requirement.") {
    super("PRIVACY_DOWNGRADE", message);
    this.name = "PrivacyDowngradeError";
  }
}
