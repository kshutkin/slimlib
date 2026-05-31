<script>
    import Self from './DeepNode.svelte';
    let { depth = 0, breadth = 4, label = '' } = $props();
</script>
{#if depth === 0}
    <span>{label}</span>
{:else}
    <div>
        {#each Array(breadth) as _, i}
            <Self depth={depth - 1} breadth={breadth} label={label + '.' + i} />
        {/each}
    </div>
{/if}
