<script>
    let items = $state([]);
    export function setItems(v) { items = v; }
</script>
{#each items as item (item.id)}
    <div>{item.label}</div>
{/each}
