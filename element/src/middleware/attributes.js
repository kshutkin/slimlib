import { DEV } from 'esm-env';

import { effect, scope } from '@slimlib/store';

import { MOUNT, UNMOUNT } from '../symbols.js';

/** @typedef {import('../types.js').Middleware} Middleware */
/** @typedef {import('../types.js').SlimHost} SlimHost */
/** @typedef {import('@slimlib/store').Scope} Scope */
/** @typedef {SlimHost & Record<typeof MOUNT | typeof UNMOUNT, (() => void)[]>} AttributeHost */
/**
 * @typedef {[parse?: (rawValue: string | null) => unknown, serialize?: (propertyValue: unknown) => (string | null)]} AttributeDescriptor
 *   Positional tuple. `parse` converts an inbound attribute string (`string | null`)
 *   into a prop value; when omitted the attribute is not observed (no prop is
 *   written on attribute changes). `serialize` converts a prop value into an
 *   attribute string, or `null` to remove the attribute; when
 *   `serialize` is present the attribute is reflected.
 */

/**
 * Observe HTML attributes, parse them into props, and optionally reflect prop
 * writes back to the DOM.
 *
 * `config` is a tuple-descriptor map (`{ count: numberAttr }`). Each descriptor
 * is a `[parse?, serialize?]` tuple; presence of `serialize` reflects the prop
 * write back to the attribute.
 *
 * @param {Record<string, AttributeDescriptor>} attributeConfig
 * @returns {Middleware}
 */
export const attributes = attributeConfig => {
    const attributeNames = Object.keys(attributeConfig);
    const observedAttributeNames = attributeNames.filter(
        attributeName => /** @type {AttributeDescriptor} */ (attributeConfig[attributeName])[0]
    );
    const reflectedAttributeNames = attributeNames.filter(
        attributeName => /** @type {AttributeDescriptor} */ (attributeConfig[attributeName])[1]
    );

    return ElementBase =>
        class extends ElementBase {
            static get observedAttributes() {
                return observedAttributeNames;
            }

            constructor() {
                super();

                if (reflectedAttributeNames.length > 0) {
                    /** @type {(() => void)[]} */ (/** @type {AttributeHost} */ (this)[MOUNT]).push(() => {
                        if (DEV) {
                            for (const attributeName of reflectedAttributeNames) {
                                if (!Object.getOwnPropertyDescriptor(this, attributeName)?.get) {
                                    console.warn(
                                        `[@slimlib/element] attribute "${attributeName}" is reflected (has a serialize function) but was not declared via props(); reflection won't track changes.`
                                    );
                                }
                            }
                        }

                        /** @type {(() => void)[]} */ (/** @type {AttributeHost} */ (this)[UNMOUNT]).push(
                            scope(() => {
                                const length = reflectedAttributeNames.length;
                                for (let index = 0; index < length; ++index) {
                                    const attributeName = /** @type {string} */ (reflectedAttributeNames[index]);
                                    const attributeDescriptor = /** @type {AttributeDescriptor} */ (attributeConfig[attributeName]);
                                    const parseAttribute = /** @type {AttributeDescriptor[0]} */ (attributeDescriptor[0]);
                                    const serializeAttribute = /** @type {NonNullable<AttributeDescriptor[1]>} */ (attributeDescriptor[1]);
                                    effect(() => {
                                        const serializedValue = serializeAttribute(
                                            /** @type {SlimHost} */ (/** @type {unknown} */ (this))[attributeName]
                                        );
                                        if (DEV && parseAttribute) {
                                            const roundTripValue = serializeAttribute(parseAttribute(serializedValue));
                                            if (roundTripValue !== serializedValue) {
                                                throw new Error(
                                                    `[@slimlib/element] attribute "${attributeName}" [parse, serialize] pair is not round-trip stable: serialize(parse(${JSON.stringify(serializedValue)})) === ${JSON.stringify(roundTripValue)} (expected ${JSON.stringify(serializedValue)}); reflection would loop.`
                                                );
                                            }
                                        }
                                        if (serializedValue == null) {
                                            if (/** @type {SlimHost} */ (/** @type {unknown} */ (this)).hasAttribute(attributeName)) {
                                                /** @type {SlimHost} */ (/** @type {unknown} */ (this)).removeAttribute(attributeName);
                                            }
                                        } else if (
                                            /** @type {SlimHost} */ (/** @type {unknown} */ (this)).getAttribute(attributeName) !==
                                            serializedValue
                                        ) {
                                            /** @type {SlimHost} */ (/** @type {unknown} */ (this)).setAttribute(
                                                attributeName,
                                                serializedValue
                                            );
                                        }
                                    }, 1 /* EAGER */);
                                }
                            })
                        );
                    });
                }
            }

            attributeChangedCallback(
                /** @type {string} */ attributeName,
                /** @type {string | null} */ _oldValue,
                /** @type {string | null} */ newValue
            ) {
                /** @type {SlimHost} */ (/** @type {unknown} */ (this))[attributeName] =
                    /** @type {[parse: (rawValue: string | null) => unknown]} */ (attributeConfig[attributeName])[0](newValue);
            }
        };
};

/** @type {AttributeDescriptor} */
export const numberAttr = [
    rawValue => (rawValue === null ? null : Number(rawValue)),
    propertyValue => (propertyValue == null ? null : String(propertyValue)),
];

/** @type {AttributeDescriptor} */
export const boolAttr = [rawValue => rawValue !== null, propertyValue => (propertyValue ? '' : null)];

/** @type {AttributeDescriptor} */
export const stringAttr = [rawValue => rawValue, propertyValue => (propertyValue == null ? null : String(propertyValue))];
