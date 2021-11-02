import { Action, Appender, LogLevel, LogMessage } from "./types";
import { green, red } from "kleur";

export function consoleAppender(logMessage: LogMessage) {
    if (logMessage.loglevel > LogLevel.verbose) {
        let prefix: string = '';
        switch (logMessage.action) {
            case Action.success:
                prefix = green('✓');
                break;
            case Action.fail:
                prefix = red('✕');
                break;
        }
        console.log(`${prefix} ${logMessage.message}`);
    }
}

export function filterMessages(predicate: (logMessage: LogMessage) => boolean, appender: Appender ): Appender {
    return function(logMessage: LogMessage) {
        if (predicate(logMessage)) {
            appender(logMessage);
        }
    }
}
