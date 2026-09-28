package com.smarte.response

import android.app.Application
import com.smarte.response.data.api.AppConfig

class EmergencyApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Initialize persistent backend configuration on cold launch / process recreation
        AppConfig.init(this)
    }
}
