package com.example.ict361_lab.network;

import com.example.ict361_lab.network.dto.AuthDtos;
import com.example.ict361_lab.network.dto.GroupDtos;
import com.example.ict361_lab.network.dto.StudentDto;
import com.example.ict361_lab.network.dto.StudentMutationDtos;
import com.example.ict361_lab.network.dto.StudentsPageDto;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.DELETE;
import retrofit2.http.GET;
import retrofit2.http.Header;
import retrofit2.http.PUT;
import retrofit2.http.POST;
import retrofit2.http.Path;
import retrofit2.http.Query;

/**
 * Mirrors backend/API_CONTRACT.md exactly — route, method and body/response
 * shapes are kept in lockstep with that document and with
 * backend/src/routes/*.js. If the backend team changes a route, update it
 * here and in API_CONTRACT.md in the same commit.
 *
 * Auth: AuthInterceptor attaches "Authorization: Bearer <token>"
 * automatically once TokenStore holds a token, so callers don't pass it.
 *
 * Idempotency: every mutating call (register is the one exception — it's
 * naturally one-shot via the claim code) takes an explicit operationId
 * parameter that becomes the "X-Operation-Id" header the backend's
 * idempotency middleware expects. Generate this ONCE per logical user
 * action with UUID.randomUUID().toString() and reuse the SAME value on
 * retry — a fresh UUID on every retry defeats the whole point.
 */
public interface ApiService {

    // ---- Auth (public) --------------------------------------------------

    @POST("api/auth/register")
    Call<AuthDtos.AuthResponse> register(@Body AuthDtos.RegisterRequest body);

    @POST("api/auth/login")
    Call<AuthDtos.AuthResponse> login(@Body AuthDtos.LoginRequest body);

    // ---- Students ---------------------------------------------------------

    /** Lecturer roster: search + programme/group filters + pagination. */
    @GET("api/students")
    Call<StudentsPageDto> listStudents(
            @Query("search") String search,
            @Query("program_code") String programCode,
            @Query("group_code") String groupCode, // "UNASSIGNED" is a valid value
            @Query("page") Integer page,
            @Query("page_size") Integer pageSize
    );

    /** The signed-in student's own profile + group occupancy. */
    @GET("api/students/me")
    Call<StudentDto> getMyProfile();

    /** Lecturer: any student. Student: only their own id (server-enforced). */
    @GET("api/students/{studentId}")
    Call<StudentDto> getStudent(@Path("studentId") String studentId);

    /** Lecturer only — pre-creates a profile and returns its claim code. */
    @POST("api/students")
    Call<StudentMutationDtos.CreateStudentResponse> createStudent(
            @Header("X-Operation-Id") String operationId,
            @Body StudentMutationDtos.CreateStudentRequest body
    );

    /** Lecturer: any editable field. Student: name/programme on their own record only. */
    @PUT("api/students/{studentId}")
    Call<StudentDto> updateStudent(
            @Path("studentId") String studentId,
            @Header("X-Operation-Id") String operationId,
            @Body StudentMutationDtos.UpdateStudentRequest body
    );

    /** Lecturer assigns/transfers; a student may request their own transfer. Same capacity rule either way. */
    @POST("api/students/{studentId}/group-transfer")
    Call<StudentMutationDtos.GroupTransferResponse> transferGroup(
            @Path("studentId") String studentId,
            @Header("X-Operation-Id") String operationId,
            @Body StudentMutationDtos.GroupTransferRequest body
    );

    /** Lecturer only, soft delete. Confirm in the UI before calling this. */
    @DELETE("api/students/{studentId}")
    Call<StudentDto> deleteStudent(
            @Path("studentId") String studentId,
            @Header("X-Operation-Id") String operationId
    );

    /** Student only — request a lecturer fix their student_number (students can't edit it directly). */
    @POST("api/students/{studentId}/correction-request")
    Call<Void> requestCorrection(
            @Path("studentId") String studentId,
            @Body StudentMutationDtos.CorrectionRequestBody body
    );

    // ---- Groups -------------------------------------------------------

    /** Any signed-in user — group codes with live occupancy, for pickers/roster headers. */
    @GET("api/groups")
    Call<GroupDtos.GroupsResponse> listGroups();
}
