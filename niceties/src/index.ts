import { consoleAppender } from "./consoleAppender";
import { Action, Appender, LogLevel } from "./types";

let globalInputId = 0;

let currentAppender: Appender = consoleAppender;

export function niceties(tag?: string) {
    let initialLogLevel: LogLevel = LogLevel.info;
    const inputId = globalInputId++;
	return {
		start(message: string, loglevel?: LogLevel) {
            if (loglevel !== undefined) {
			    initialLogLevel = loglevel;
            }
            currentAppender({
                action: Action.start,
                inputId,
                message,
                loglevel: initialLogLevel,
                tag
            });
		},
        update(message: string, loglevel?: LogLevel) {
            currentAppender({
                action: Action.update,
                inputId,
                message,
                loglevel: loglevel || initialLogLevel,
                tag
            });
        },
        success(message: string, loglevel?: LogLevel) {
            currentAppender({
                action: Action.success,
                inputId,
                message,
                loglevel: loglevel || initialLogLevel,
                tag
            });
        },
        fail(message: string) {
            currentAppender({
                action: Action.fail,
                inputId,
                message,
                loglevel: LogLevel.error,
                tag
            });
        }
	}
}

export function setAppender(appender: Appender) {
    currentAppender = appender;
}

export { consoleAppender };
