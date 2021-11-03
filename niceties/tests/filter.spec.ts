import { Action, filterMessages, LogLevel } from '../src';

describe('filter', () => {

    it('filter out message', () => {
        const mockAppender = jest.fn();
        const decoratedAppender = filterMessages(() => false, mockAppender);
        decoratedAppender({loglevel: LogLevel.info, message: 'test', action: Action.start, inputId: 0});
        expect(mockAppender).not.toBeCalled();
    });

    it('filter passes message', () => {
        const mockAppender = jest.fn();
        const decoratedAppender = filterMessages(() => true, mockAppender);
        decoratedAppender({loglevel: LogLevel.info, message: 'test', action: Action.start, inputId: 0});
        expect(mockAppender).toBeCalledWith({loglevel: LogLevel.info, message: 'test', action: Action.start, inputId: 0});
    });

});