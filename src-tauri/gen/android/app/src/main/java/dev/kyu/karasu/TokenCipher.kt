package dev.kyu.karasu

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Hand-written; `tauri android init` will not recreate it, restore from git; the key never leaves the Keystore. */
object TokenCipher { // reached from keystore.rs over JNI by name: the proguard keep is load-bearing
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

    /** iv || ciphertext+tag; throws on any Keystore refusal, so the Rust side reports instead of guessing. */
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
