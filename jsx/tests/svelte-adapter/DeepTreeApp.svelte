<script>
    import DeepNode from './DeepNode.svelte';
    let { depth = 6, breadth = 4, initialLabel = 'A' } = $props();
    let label = $state('A');
    $effect.pre(() => {
        label = initialLabel;
    });
    export function setLabel(v) { label = v; }
</script>
<DeepNode {depth} {breadth} {label} />
