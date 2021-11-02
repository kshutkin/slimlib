import { niceties, setAppender } from '../src';
import { Action, LogLevel } from '../src/types';

describe('api tests', () => {
    it('without a tag', () => {
        const appenderMock = jest.fn();
        setAppender(appenderMock);
        niceties().start('test message');
        expect(appenderMock).toBeCalledWith(
            expect.objectContaining({
                tag: undefined
            })
        );
    });

    it('with a tag', () => {
        const appenderMock = jest.fn();
        setAppender(appenderMock);
        niceties('a tag').start('test message');
        expect(appenderMock).toBeCalledWith(
            expect.objectContaining({
                tag: 'a tag'
            })
        );
    });

    describe('start', () => {
        it('with default log level', () => {
            const appenderMock = jest.fn();
            setAppender(appenderMock);
            niceties().start('test message');
            expect(appenderMock).toBeCalledWith(
                expect.objectContaining({
                    action: Action.start, 
                    inputId: expect.any(Number), 
                    loglevel: LogLevel.info, 
                    message: 'test message'
                })
            );
        });

        it('with overriden log level', () => {
            const appenderMock = jest.fn();
            setAppender(appenderMock);
            niceties().start('test message', LogLevel.verbose);
            expect(appenderMock).toBeCalledWith(
                expect.objectContaining({
                    action: Action.start, 
                    inputId: expect.any(Number), 
                    loglevel: LogLevel.verbose, 
                    message: 'test message'
                })
            );
        });
    });

    describe('update', () => {
        it('without start', () => {
            const appenderMock = jest.fn();
            setAppender(appenderMock);
            niceties().update('test message');
            expect(appenderMock).toBeCalledWith(
                expect.objectContaining({
                    action: Action.update, 
                    inputId: expect.any(Number), 
                    loglevel: LogLevel.info, 
                    message: 'test message'
                })
            );
        });

        it('receives initial log level', () => {
            const appenderMock = jest.fn();
            setAppender(appenderMock);
            const instance = niceties();
            instance.start('start', LogLevel.verbose)
            instance.update('test message');
            expect(appenderMock).toBeCalledWith(
                expect.objectContaining({
                    action: Action.update, 
                    inputId: expect.any(Number), 
                    loglevel: LogLevel.verbose, 
                    message: 'test message'
                })
            );
        });

        it('with overriden log Level', () => {
            const appenderMock = jest.fn();
            setAppender(appenderMock);
            const instance = niceties();
            instance.start('start', LogLevel.verbose)
            instance.update('test message', LogLevel.warn);
            expect(appenderMock).toBeCalledWith(
                expect.objectContaining({
                    action: Action.update, 
                    inputId: expect.any(Number), 
                    loglevel: LogLevel.warn, 
                    message: 'test message'
                })
            );
        });
    });

    describe('success', () => {
        it('without start', () => {
            const appenderMock = jest.fn();
            setAppender(appenderMock);
            niceties().success('test message');
            expect(appenderMock).toBeCalledWith(
                expect.objectContaining({
                    action: Action.success, 
                    inputId: expect.any(Number), 
                    loglevel: LogLevel.info, 
                    message: 'test message'
                })
            );
        });

        it('receives initial log level', () => {
            const appenderMock = jest.fn();
            setAppender(appenderMock);
            const instance = niceties();
            instance.start('start', LogLevel.verbose)
            instance.success('test message');
            expect(appenderMock).toBeCalledWith(
                expect.objectContaining({
                    action: Action.success, 
                    inputId: expect.any(Number), 
                    loglevel: LogLevel.verbose, 
                    message: 'test message'
                })
            );
        });

        it('with overriden log Level', () => {
            const appenderMock = jest.fn();
            setAppender(appenderMock);
            const instance = niceties();
            instance.start('start', LogLevel.verbose)
            instance.success('test message', LogLevel.warn);
            expect(appenderMock).toBeCalledWith(
                expect.objectContaining({
                    action: Action.success, 
                    inputId: expect.any(Number), 
                    loglevel: LogLevel.warn, 
                    message: 'test message'
                })
            );
        });
    });

    describe('fail', () => {
        const appenderMock = jest.fn();
        setAppender(appenderMock);
        niceties().fail('test message');
        expect(appenderMock).toBeCalledWith(
            expect.objectContaining({
                action: Action.fail, 
                inputId: expect.any(Number), 
                loglevel: LogLevel.error, 
                message: 'test message'
            })
        );
    });

});