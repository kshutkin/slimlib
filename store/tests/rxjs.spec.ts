import { createStore, toObservable } from '../src/rxjs';

const [state, store] = createStore({ count: 0 });

describe('toObservable', () => {
    it('should return an observable', () => {
        expect(toObservable(store)).toBeDefined();
    });

    it('should emit the initial value', (done) => {
        toObservable(store).subscribe((value) => {
            expect(value).toEqual({ count: 0 });
            done();
        });
    });

    it('should emit the new value', (done) => {
        toObservable(store).subscribe((value) => {
            expect(value).toEqual({ count: 1 });
            done();
        });

        state.count++;
    });
});