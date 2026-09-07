package com.smarte.response.data.api

import com.google.gson.Gson
import com.smarte.response.data.model.GenericResponse
import com.smarte.response.data.model.SnapshotResponse
import com.smarte.response.data.model.TeamDetailResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * HTTP REST Client interfacing directly with Node.js Express backend.
 */
class EmergencyApiClient(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .writeTimeout(8, TimeUnit.SECONDS)
        .build(),
    private val gson: Gson = Gson()
) {
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun getState(): Result<SnapshotResponse> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url(AppConfig.baseUrl + "/api/state")
                .get()
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    return@withContext Result.failure(IOException("HTTP " + response.code + ": " + response.message))
                }
                val bodyStr = response.body?.string() ?: ""
                val snapshot = gson.fromJson(bodyStr, SnapshotResponse::class.java)
                Result.success(snapshot)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getTeam(teamId: String): Result<TeamDetailResponse> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url(AppConfig.baseUrl + "/api/teams/" + teamId)
                .get()
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    return@withContext Result.failure(IOException("HTTP " + response.code + ": " + response.message))
                }
                val bodyStr = response.body?.string() ?: ""
                val teamDetail = gson.fromJson(bodyStr, TeamDetailResponse::class.java)
                Result.success(teamDetail)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun updateTeamStatus(teamId: String, status: String): Result<GenericResponse> = withContext(Dispatchers.IO) {
        try {
            val jsonPayload = gson.toJson(mapOf("status" to status))
            val body = jsonPayload.toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url(AppConfig.baseUrl + "/api/teams/" + teamId + "/status")
                .post(body)
                .build()

            client.newCall(request).execute().use { response ->
                val bodyStr = response.body?.string() ?: ""
                val result = gson.fromJson(bodyStr, GenericResponse::class.java)
                if (response.isSuccessful && result.success) {
                    Result.success(result)
                } else {
                    Result.failure(IOException(result?.error ?: ("HTTP " + response.code + ": Failed to update status")))
                }
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun updateTeamLocation(teamId: String, nodeId: String, lat: Double, lon: Double): Result<GenericResponse> = withContext(Dispatchers.IO) {
        try {
            val payload = mutableMapOf<String, Any>(
                "nodeId" to nodeId,
                "lat" to lat,
                "lon" to lon
            )
            val body = gson.toJson(payload).toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url(AppConfig.baseUrl + "/api/teams/" + teamId + "/location")
                .post(body)
                .build()

            client.newCall(request).execute().use { response ->
                val bodyStr = response.body?.string() ?: ""
                val result = gson.fromJson(bodyStr, GenericResponse::class.java)
                if (response.isSuccessful && result.success) {
                    Result.success(result)
                } else {
                    Result.failure(IOException(result?.error ?: ("HTTP " + response.code + ": Failed to update location")))
                }
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun acceptAssignment(assignmentId: String): Result<GenericResponse> = withContext(Dispatchers.IO) {
        try {
            val body = gson.toJson(emptyMap<String, String>()).toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url(AppConfig.baseUrl + "/api/assignments/" + assignmentId + "/accept")
                .post(body)
                .build()

            client.newCall(request).execute().use { response ->
                val bodyStr = response.body?.string() ?: ""
                val result = gson.fromJson(bodyStr, GenericResponse::class.java)
                if (response.isSuccessful && result.success) {
                    Result.success(result)
                } else {
                    Result.failure(IOException(result?.error ?: "Failed to accept assignment"))
                }
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun declineAssignment(assignmentId: String, reason: String = "Driver unavailable"): Result<GenericResponse> = withContext(Dispatchers.IO) {
        try {
            val body = gson.toJson(mapOf("reason" to reason)).toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url(AppConfig.baseUrl + "/api/assignments/" + assignmentId + "/decline")
                .post(body)
                .build()

            client.newCall(request).execute().use { response ->
                val bodyStr = response.body?.string() ?: ""
                val result = gson.fromJson(bodyStr, GenericResponse::class.java)
                if (response.isSuccessful && result.success) {
                    Result.success(result)
                } else {
                    Result.failure(IOException(result?.error ?: "Failed to decline assignment"))
                }
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun completeEmergency(emergencyId: String): Result<GenericResponse> = withContext(Dispatchers.IO) {
        try {
            val body = gson.toJson(emptyMap<String, String>()).toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url(AppConfig.baseUrl + "/api/emergencies/" + emergencyId + "/complete")
                .post(body)
                .build()

            client.newCall(request).execute().use { response ->
                val bodyStr = response.body?.string() ?: ""
                val result = gson.fromJson(bodyStr, GenericResponse::class.java)
                if (response.isSuccessful && result.success) {
                    Result.success(result)
                } else {
                    Result.failure(IOException(result?.error ?: "Failed to complete emergency"))
                }
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
