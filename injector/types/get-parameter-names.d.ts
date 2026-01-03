declare module 'get-parameter-names' {
    // biome-ignore lint/complexity/noBannedTypes: external module declaration
    export default function getParameterNames(func: Function | string): string[];
}
