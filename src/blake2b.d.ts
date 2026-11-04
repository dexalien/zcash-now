/**
 * Minimal types for the `blake2b` package, which ships none.
 *
 * Only the surface this project uses is declared. The personalization
 * parameter is what matters here: ZIP 316's F4Jumble needs a 16-byte
 * personalization and an arbitrary output length, and this package supports
 * both.
 */
declare module "blake2b" {
  interface Blake2b {
    update(input: Uint8Array): Blake2b;
    digest(out: Uint8Array): Uint8Array;
    digest(encoding: "hex"): string;
  }

  /**
   * @param outlen Output length in bytes.
   * @param key Optional MAC key.
   * @param salt Optional 16-byte salt.
   * @param personal Optional 16-byte personalization.
   */
  function createHash(
    outlen: number,
    key?: Uint8Array | null,
    salt?: Uint8Array | null,
    personal?: Uint8Array | null,
    noAssert?: boolean,
  ): Blake2b;

  export = createHash;
}
