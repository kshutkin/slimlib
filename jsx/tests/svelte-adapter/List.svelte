<script>
    let items = $state([]);
    export function setItems(v) { items = v; }
</script>
{#each items as item}
    <div>{item}</div>
{/each}
