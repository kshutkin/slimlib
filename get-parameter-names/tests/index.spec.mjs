/** biome-ignore-all lint/complexity/noUselessConstructor: tests */
/** biome-ignore-all lint/correctness/noUnusedFunctionParameters: tests */
import { describe, expect, it } from 'vitest';

import getParametersNames from '../src/index.js';

describe('function tests', () => {
    it('test1', () => {
        function /* (no parenthesis like this) */ test1(a, b, c) {
            return true;
        }
        expect(getParametersNames(test1)).toEqual(['a', 'b', 'c']);
    });

    it('test2', () => {
        function test2(a, b, c) /*(why do people do this??)*/ {
            return true;
        }

        expect(getParametersNames(test2)).toEqual(['a', 'b', 'c']);
    });

    it('test3', () => {
        function test3(a, /* (jewiofewjf,wo, ewoi, werp)*/ b, c) {
            return true;
        }

        expect(getParametersNames(test3)).toEqual(['a', 'b', 'c']);
    });

    it('test4', () => {
        function test4(a /* a*/, /* b */ b, /*c*/ c, d /*d*/) {
            return (one, two, three) => {};
        }

        expect(getParametersNames(test4)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('test5', () => {
        function test5(a, b, c) {
            return false;
        }

        expect(getParametersNames(test5)).toEqual(['a', 'b', 'c']);
    });

    it('test6', () => {
        function test6(a) {
            return function f6(a, b) {};
        }

        expect(getParametersNames(test6)).toEqual(['a']);
    });

    it('test7', () => {
        function test7(
            /*
     function test5(
       a,
       b,
       c
     ) {
       return false;
     }
     function test5(
       a,
       b,
       c
     ) {
       return false;
     }
     function test5(
       a,
       b,
       c
     ) {
       return false;
     }
     */
            a,
            b,
            c
        ) {
            return true;
        }

        expect(getParametersNames(test7)).toEqual(['a', 'b', 'c']);
    });

    it('test8', () => {
        function test8(a, b, c) {}

        expect(getParametersNames(test8)).toEqual(['a', 'b', 'c']);
    });

    it('test9', () => {
        function π9(ƒ, µ) {}

        expect(getParametersNames(π9)).toEqual(['ƒ', 'µ']);
    });

    it('test10', () => {
        function test9() {}
        expect(getParametersNames(test9)).toEqual([]);
    });

    it('supports ES2015 fat arrow functions with parens', () => {
        var f = '(a,b) => a + b';

        expect(getParametersNames(f)).toEqual(['a', 'b']);
    });

    it('supports ES2015 fat arrow functions without parens', () => {
        var f = 'a => a + 2';
        expect(getParametersNames(f)).toEqual(['a']);
    });

    it('supports function with name followed by double opening paren', () => {
        var f = 'function func(()=>x) {}';
        expect(getParametersNames(f)).toEqual(['']);
    });

    it('supports ES2015 fat arrow functions without parens and new line no parens fat arrow function', () => {
        var f = 'a => a.map(\n b => b)';
        expect(getParametersNames(f)).toEqual(['a']);
    });

    it('supports ES2015 fat arrow function without parens test1.', () => {
        var f = 'c => {\n' + '  var test2 = c.resolve();\n' + '  return new Test3(test2);\n' + '}';

        expect(getParametersNames(f)).toEqual(['c']);
    });

    it('supports ES2015 fat arrow function without parens test2.', () => {
        var f =
            'a => {\n' + '  return new Promise((resolve, reject) => {\n' + '    setTimeout(() => resolve(a * 2), 500);\n' + '  })' + '}';

        expect(getParametersNames(f)).toEqual(['a']);
    });

    it('supports ES2015 fat arrow function without parens test3.', () => {
        var f = 'items => items.map(\n' + '  i => t.foo)';

        expect(getParametersNames(f)).toEqual(['items']);
    });

    it('supports ES2015 fat arrow function without arguments.', () => {
        var f = '() => 1';

        expect(getParametersNames(f)).toEqual([]);
    });

    it('ignores ES2015 default params', () => {
        // default params supported in node.js ES6
        var f11 = '(a, b = 20) => a + b';

        expect(getParametersNames(f11)).toEqual(['a', 'b']);
    });

    it('supports function created using the Function constructor', () => {
        var f = new Function('a', 'b', 'return a + b');

        expect(getParametersNames(f)).toEqual(['a', 'b']);
    });

    it('supports ES2015 default params with fat arrow function with multiple arguments', () => {
        var f = '( a = 1 , b=2, c = (err, data)=>{}) => {}';

        expect(getParametersNames(f)).toEqual(['a', 'b', 'c']);
    });

    it('ES2015 default params with fat arrow function in middle', () => {
        var f = '( a = 1 , b= (err, data)=>{}, c = 3) => {}';

        expect(getParametersNames(f)).toEqual(['a', 'b', 'c']);
    });

    it('ES2015 default params with var re-assignment to an argument like value', () => {
        var f = "function f(id = 1){ id = 'a,b'; }";

        expect(getParametersNames(f)).toEqual(['id']);
    });

    it('ignores ES2016 async keyword test 1', () => {
        var f = 'async (a, b) => a + b';

        expect(getParametersNames(f)).toEqual(['a', 'b']);
    });

    it('ignores ES2016 async keyword test 2', () => {
        var f = 'async a => a';

        expect(getParametersNames(f)).toEqual(['a']);
    });

    it('ignores ES2016 async keyword test 3', () => {
        var f = 'async(a) => a';

        expect(getParametersNames(f)).toEqual(['a']);
    });

    it('ignores ES2016 async keyword test 4', () => {
        var f = 'async function(async, b) { return a + b }';

        expect(getParametersNames(f)).toEqual(['async', 'b']);
    });

    it('ignores ES2016 async keyword test 5', () => {
        var f = 'async function myfunc(async, b) { return a + b }';

        expect(getParametersNames(f)).toEqual(['async', 'b']);
    });

    it('ignores ES2016 async keyword test 6', () => {
        var f = 'function async(async, b) { return a + b }';

        expect(getParametersNames(f)).toEqual(['async', 'b']);
    });

    it('ignores ES2016 async keyword test 7', () => {
        var f = '(async) => 33';

        expect(getParametersNames(f)).toEqual(['async']);
    });

    it('ignores ES2016 async keyword test 8', () => {
        var f = 'async => 33';

        expect(getParametersNames(f)).toEqual(['async']);
    });

    describe('ES2016 Class', () => {
        it('constructor with static get before constructor', () => {
            var f =
                'class Cat {\n      static get foo () {\n  ' +
                'return [];\n      }\n      static get bar () {\n' +
                'return [];\n      }\n      constructor(a, b){}\n    }';

            expect(getParametersNames(f)).toEqual(['a', 'b']);
        });

        it('static get before constructor', () => {
            class Cat {
                static get fido() {
                    return 'fido';
                }
                constructor() {}
            }
            expect(getParametersNames(Cat)).toEqual([]);
        });

        it('class with empty constructor', () => {
            class Cat {
                constructor() {}
            }
            expect(getParametersNames(Cat)).toEqual([]);
        });

        it('class with static get after constructor', () => {
            class Cat {
                constructor(a, b) {}
                static get fido() {
                    return 'fido';
                }
            }
            expect(getParametersNames(Cat)).toEqual(['a', 'b']);
        });

        it('class constructor with inheritance', () => {
            class Animal {
                constructor() {}
            }
            class Cat extends Animal {
                constructor(a, b) {
                    super();
                    expect(getParametersNames(this.constructor)).toEqual(['a', 'b']);
                }
            }
            expect(getParametersNames(Cat)).toEqual(['a', 'b']);
        });
    });
});
