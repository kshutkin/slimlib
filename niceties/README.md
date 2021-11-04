# Niceties

Experimental logger/reporter for async tasks.

Provides API for reporting async events that can be later handled by cutom appender.

Provides default appender that uses console for output.

# Installation

```
yarn add niceties
```

or

```
npm install --save niceties
```

# Example

```
import { niceties } from 'niceties';

const logger = niceties();

try {
    logger.start('starting something');
    ...
    // some async code
    ...
    logger.success('finished something');
} catch(e) {
    logger.fail('finished something');
}
```

# API

Main entry point for logger:

```
function niceties(tag?: string): {
    start(message: string, loglevel?: LogLevel | undefined): void;
    update(message: string, loglevel?: LogLevel | undefined): void;
    success(message: string, loglevel?: LogLevel | undefined): void;
    fail(message: string): void;
};
```

Will return a logger instance that can be viewed as an entry for a single async task. `tag` can be used to distinguish between async tasks (will be provided to appender).

`start(message: string, loglevel?: LogLevel | undefined): void;`

Emits start event inside a logger. If loglevel provided it will be remembered and used as default loglevel in subsequent events in the same logger instance. Default loglevel (if argument is not provided) is `info`.

`update(message: string, loglevel?: LogLevel | undefined): void;`

Emits update event. Can be used to inform user that we are doing something else in the same async task. loglevel used to redefine default loglevel.

`success(message: string, loglevel?: LogLevel | undefined): void;`

Emits success event. Can be used to inform user that task succesfully finished. loglevel used to redefine default loglevel.

`fail(message: string): void;`

Emits fail event. Can be used to inform user that task finished and failed. loglevel is always error.

## Log levels

```
const enum LogLevel {
    verbose, // for debugging logs, not for displaying on screen in normal cases
    info, // should be printed to user but not an error
    warn, // something is probably wrong, but we can continue
    error // operation completely failed
}
```

## Setting another appender

User or another library can set another appender by calling:

```
function setAppender(appender: Appender);
```

where appender is a function with following type

```
(message: LogMessage) => void

const enum Action {
    start,
    update,
    success,
    fail
}

interface LogMessage {
    inputId: number;
    loglevel: LogLevel;
    message: string;
    action: Action;
    tag?: string;
}
```

# Licence

[MIT](./LICENCE)