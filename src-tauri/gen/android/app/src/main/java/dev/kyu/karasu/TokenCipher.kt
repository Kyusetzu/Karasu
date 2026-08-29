package dev.kyu.karasu

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Hand-written, not generated. `tauri android init` will not overwrite this
 * file — but a wiped gen/ tree will not recreate it either: restore it from
 * git if sign-in ever dies with "TokenCipher" in the log.
 *
 * Deliberately pure platform API (java.security / javax.crypto): a Gradle
 * dependency inside this generated tree is exactly what net.rs refused for
 * TLS, and Keystore needs none. Rust calls the two statics over JNI
 * (src-tauri/src/keystore.rs) and owns the file format; this class only
 * turns bytes into iv||ciphertext under an AES-256-GCM key that never
 * leaves the Android Keystore. The proguard keep rule in
 * app/proguard-rules.pro is load-bearing — a minified release renames
 * JNI-reached classes and the calls fail only at runtime.
 */
object TokenCipher {
    private const val ALIAS = "karasu-secrets"
    private const val IV_LEN = 12

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    /** iv(12) || ciphertext+tag. Throws on any Keystore refusal — the Rust
     *  side reports, it does not guess. */
    @JvmStatic
    fun seal(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        return cipher.iv + cipher.doFinal(plain)
    }

    @JvmStatic
    fun open(sealed: ByteArray): ByteArray {
        require(sealed.size > IV_LEN) { "sealed blob too short" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, IV_LEN))
        return cipher.doFinal(sealed, IV_LEN, sealed.size - IV_LEN)
    }
}
