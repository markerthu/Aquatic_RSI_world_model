// Loader hook: the drawing code imports three.js, which a Node replay does not need.
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: 'data:text/javascript,export default {}', shortCircuit: true };
  return next(specifier, context);
}
