package com.smarte.response.data.api

import org.junit.Assert.*
import org.junit.Test

class AppConfigTest {

    @Test
    fun testDefaultBaseUrlAndWsUrl() {
        assertEquals("http://10.0.2.2:4000", AppConfig.DEFAULT_EMULATOR_BASE_URL)
        val ws = AppConfig.getWsUrlFromBaseUrl("http://10.0.2.2:4000")
        assertEquals("ws://10.0.2.2:4000/ws", ws)
    }

    @Test
    fun testUrlNormalizationWithTrailingSlashes() {
        val result = AppConfig.validateAndNormalizeUrl("http://192.168.1.13:4000///")
        assertTrue(result.isSuccess)
        assertEquals("http://192.168.1.13:4000", result.getOrThrow())
        assertEquals("ws://192.168.1.13:4000/ws", AppConfig.getWsUrlFromBaseUrl(result.getOrThrow()))
    }

    @Test
    fun testUrlNormalizationWithoutScheme() {
        val result = AppConfig.validateAndNormalizeUrl("192.168.1.50:4000")
        assertTrue(result.isSuccess)
        assertEquals("http://192.168.1.50:4000", result.getOrThrow())
    }

    @Test
    fun testUrlNormalizationWithoutPortDefaultsTo4000() {
        val result = AppConfig.validateAndNormalizeUrl("192.168.1.50")
        assertTrue(result.isSuccess)
        assertEquals("http://192.168.1.50:4000", result.getOrThrow())
    }

    @Test
    fun testUrlNormalizationEmulatorHost() {
        val result = AppConfig.validateAndNormalizeUrl("10.0.2.2")
        assertTrue(result.isSuccess)
        assertEquals("http://10.0.2.2:4000", result.getOrThrow())
    }

    @Test
    fun testUrlNormalizationHttpsAndCustomPort() {
        val result = AppConfig.validateAndNormalizeUrl("https://emergency-center.org:8443")
        assertTrue(result.isSuccess)
        assertEquals("https://emergency-center.org:8443", result.getOrThrow())
        assertEquals("wss://emergency-center.org:8443/ws", AppConfig.getWsUrlFromBaseUrl(result.getOrThrow()))
    }

    @Test
    fun testEmptyUrlRejected() {
        val result = AppConfig.validateAndNormalizeUrl("   ")
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("cannot be empty") == true)
    }

    @Test
    fun testInvalidProtocolRejected() {
        val result = AppConfig.validateAndNormalizeUrl("ftp://192.168.1.13:4000")
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("Protocol must be http:// or https://") == true)
    }

    @Test
    fun testInvalidPortRejected() {
        val result = AppConfig.validateAndNormalizeUrl("http://192.168.1.13:70000")
        assertTrue(result.isFailure)
    }
}
