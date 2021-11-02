import { Appender, LogMessage } from "./types";

export function filterMessages(predicate: (logMessage: LogMessage) => boolean, appender: Appender ): Appender {
    return function(logMessage: LogMessage) {
        if (predicate(logMessage)) {
            appender(logMessage);
        }
    }
}
