import getParameterNames from 'get-parameter-names';

export type Provider = (key: string, value: unknown) => void;

export default () => {
    const dependencies: Record<string, unknown> = Object.create(null);

    dependencies['$provide'] = (key: string, value: unknown) => {
        dependencies[key] = value;
    };
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return <F extends (...args: any[]) => any>(func: F, scope: object = {}) =>
        func.apply(
            scope,
            getParameterNames(func)
                .map((key: string) => dependencies[key])
        ) as ReturnType<F>;
};
