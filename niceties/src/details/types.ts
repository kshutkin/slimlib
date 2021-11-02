export const enum LogLevel {
    verbose, // for debugging logs, not for displaying on screen in normal cases
    info, // should be printed to user but not an error
    warn, // something is probably wrong, but we can continue
    error // operation completely failed
}

export const enum Action {
    start,
    update,
    success,
    fail
}

export interface LogMessage {
    inputId: number;
    loglevel: LogLevel;
    message: string;
    action: Action;
    tag?: string;
}

export type Appender = (message: LogMessage) => void;
