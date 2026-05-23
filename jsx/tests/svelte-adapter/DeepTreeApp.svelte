<script>
    import DeepNode from './DeepNode.svelte';
    let props = $props();
    let label = $state(props.initialLabel ?? 'A');
    export function setLabel(v) { label = v; }
</script>
<DeepNode depth={props.depth ?? 6} breadth={props.breadth ?? 4} {label} />
