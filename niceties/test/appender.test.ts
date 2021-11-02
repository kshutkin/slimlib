import { green, red } from 'kleur';
import { consoleAppender } from '../src';
import { Action, LogLevel } from '../src/types';

describe('console appender', () => {

    let consoleLogMock: jest.MockInstance<void, string[]>;

    beforeEach(() => {
        consoleLogMock = jest.spyOn(global.console, 'log').mockImplementation();
    });

    afterEach(() => {
        consoleLogMock.mockRestore();
    });

    it('log info start', () => {
        consoleAppender({loglevel: LogLevel.info, message: 'test', action: Action.start, inputId: 0});

        expect(consoleLogMock).toBeCalledWith(' test');
    });

    it('log warn start', () => {
        consoleAppender({loglevel: LogLevel.warn, message: 'test', action: Action.start, inputId: 0});

        expect(consoleLogMock).toBeCalledWith(' test');
    });

    it('log info update', () => {
        consoleAppender({loglevel: LogLevel.info, message: 'test', action: Action.update, inputId: 0});

        expect(consoleLogMock).toBeCalledWith(' test');
    });

    it('log info success', () => {
        consoleAppender({loglevel: LogLevel.info, message: 'test', action: Action.success, inputId: 0});

        expect(consoleLogMock).toBeCalledWith(`${green('✓')} test`);
    });

    it('log fail', () => {
        consoleAppender({loglevel: LogLevel.error, message: 'test', action: Action.fail, inputId: 0});

        expect(consoleLogMock).toBeCalledWith(`${red('✕')} test`);
    });

    it('log verbose', () => {
        consoleAppender({loglevel: LogLevel.verbose, message: 'test', action: Action.update, inputId: 0});

        expect(consoleLogMock).not.toBeCalled();
    });
});
