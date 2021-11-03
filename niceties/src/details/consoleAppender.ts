import { Action, LogLevel, LogMessage } from './types';
import { green, red } from 'kleur';

export function consoleAppender(logMessage: LogMessage) {
    if (logMessage.loglevel > LogLevel.verbose) {
        let prefix = '';
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
