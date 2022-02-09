import Benchmark from 'benchmark';
import kleur from 'kleur';
import { append, prepend, remove, List } from '../dist/index.mjs';

const options = {
    setup: function() {
        global.gc();
        console.log(kleur.yellow('gc'));
    }
};

let list, array, set;

[1, 10, 100, 1000, 10000, 100000].forEach((count) => {
    fillWithElements(count);

    const suite = new Benchmark.Suite(`add item to collection end - initially with ${count} elements`, options);

    suite.add('list append', function() {
        append(list, {});
    });

    suite.add('array push', function() {
        array.push({});
    });

    suite.add('set add', function() {
        set.add({});
    });

    run(suite);
});

[1, 10, 100, 1000, 10000, 100000].forEach((count) => {
    fillWithElements(count);

    const suite = new Benchmark.Suite(`add item to collection start - initially with ${count} elements`, options);

    suite.add('list prepend', function() {
        prepend(list, {});
    });

    suite.add('array unshift', function() {
        array.unshift({});
    });

    run(suite);
});

[1, 10, 100, 1000, 10000, 100000].forEach((count) => {
    fillWithElements(count);

    const suite = new Benchmark.Suite(`add item to collection start - initially with ${count} elements`, options);

    suite.add('list prepend', function() {
        prepend(list, {});
    });

    suite.add('array unshift', function() {
        array.unshift({});
    });

    run(suite);
});

[1, 10, 100, 1000, 10000, 100000].forEach((count) => {
    fillWithElements(count);

    const suite = new Benchmark.Suite(`append to end/remove from beginning - initially with ${count} elements`, options);

    suite.add('list', function() {
        append(list, {});
        remove(list.n);
    });
    
    suite.add('array unshift', function() {
        array.push({});
        array.splice(0, 1);
    });
    
    suite.add('set', function() {
        set.add({});
        const iterator = set.values();
        set.delete(iterator.next().value);
    });
    
    run(suite);
});

// generate data

function resetToEmptyState() {
    list = new List();
    array = [];
    set = new Set();
}

function fillWithElements(count) {
    resetToEmptyState();
    for (let i = 0; i < count; ++i) {
        append(list, { value: i });
        array.push({ value: i });
        set.add({ value: i });
    }
}

// run

function run(someSuite) {

    console.log(kleur.blue(String(someSuite.name)));

    someSuite.on('cycle', function(event) {
        console.log(String(event.target));
    });
    
    someSuite.on('complete', function() {
        console.log('Fastest is ' + kleur.red(this.filter('fastest').map('name')));
    });
    
    someSuite.run();
}
