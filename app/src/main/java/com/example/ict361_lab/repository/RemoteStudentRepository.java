package com.example.ict361_lab.repository;

import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;

import com.example.ict361_lab.model.AuthResult;
import com.example.ict361_lab.model.GroupInfo;
import com.example.ict361_lab.model.Student;
import com.example.ict361_lab.network.ApiService;
import com.example.ict361_lab.network.TokenStore;
import com.example.ict361_lab.network.dto.ApiError;
import com.example.ict361_lab.network.dto.AuthDtos;
import com.example.ict361_lab.network.dto.GroupDtos;
import com.example.ict361_lab.network.dto.StudentDto;
import com.example.ict361_lab.network.dto.StudentMutationDtos;
import com.example.ict361_lab.network.dto.StudentsPageDto;
import com.google.gson.Gson;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

/**
 * Talks to the real backend. Every Retrofit call is async (enqueue) so
 * network I/O never runs on the calling thread — screens can observe the
 * returned LiveData directly. On success the JWT is stored via TokenStore
 * so AuthInterceptor can attach it to subsequent calls automatically.
 *
 * NOTE for the local-storage/sync team: this class has no offline
 * behaviour at all — if there's no connection, every LiveData resolves to
 * Resource.error(...) and that's it. Don't add Room caching or queuing
 * logic HERE; wrap this class from a new offline-first repository that
 * also implements StudentRepository (see notes.txt) so callers of the
 * interface never need to change.
 */
public class RemoteStudentRepository implements StudentRepository {

    private final ApiService api;
    private final TokenStore tokenStore;
    private final Gson gson = new Gson();

    public RemoteStudentRepository(ApiService api, TokenStore tokenStore) {
        this.api = api;
        this.tokenStore = tokenStore;
    }

    // ---- mapping helpers --------------------------------------------------

    private static Student toDomain(StudentDto dto) {
        if (dto == null) return null;
        return new Student(dto.studentId, dto.studentNumber, dto.studentName, dto.status,
                dto.version, dto.programCode, dto.groupCode);
    }

    private static GroupInfo toDomain(GroupDtos.GroupDto dto) {
        return new GroupInfo(dto.groupCode, dto.capacity, dto.activeCount);
    }

    /** Extracts the backend's {error, message} body from a failed Retrofit response. */
    private String errorMessage(Response<?> response) {
        try {
            if (response.errorBody() != null) {
                ApiError apiError = gson.fromJson(response.errorBody().string(), ApiError.class);
                if (apiError != null && apiError.message != null) return apiError.message;
            }
        } catch (IOException | com.google.gson.JsonSyntaxException ignored) {
            // fall through to the generic message below
        }
        return "Request failed (HTTP " + response.code() + ")";
    }

    // ---- Auth ---------------------------------------------------------

    @Override
    public LiveData<Resource<AuthResult>> login(String username, String password) {
        MutableLiveData<Resource<AuthResult>> result = new MutableLiveData<>(Resource.loading(null));
        api.login(new AuthDtos.LoginRequest(username, password)).enqueue(new Callback<AuthDtos.AuthResponse>() {
            @Override
            public void onResponse(Call<AuthDtos.AuthResponse> call, Response<AuthDtos.AuthResponse> response) {
                if (response.isSuccessful() && response.body() != null) {
                    AuthDtos.AuthResponse body = response.body();
                    tokenStore.save(body.token, body.role, body.studentId, body.accountId);
                    result.postValue(Resource.success(new AuthResult(body.accountId, body.studentId, body.role, body.token)));
                } else {
                    result.postValue(Resource.error(errorMessage(response), null));
                }
            }

            @Override
            public void onFailure(Call<AuthDtos.AuthResponse> call, Throwable t) {
                result.postValue(Resource.error(networkErrorMessage(t), null));
            }
        });
        return result;
    }

    @Override
    public LiveData<Resource<AuthResult>> register(String claimCode, String studentName, String studentNumber,
                                                     String programCode, String username, String password) {
        MutableLiveData<Resource<AuthResult>> result = new MutableLiveData<>(Resource.loading(null));
        AuthDtos.RegisterRequest body = new AuthDtos.RegisterRequest(claimCode, studentName, studentNumber,
                programCode, username, password);
        api.register(body).enqueue(new Callback<AuthDtos.AuthResponse>() {
            @Override
            public void onResponse(Call<AuthDtos.AuthResponse> call, Response<AuthDtos.AuthResponse> response) {
                if (response.isSuccessful() && response.body() != null) {
                    AuthDtos.AuthResponse resp = response.body();
                    tokenStore.save(resp.token, resp.role, resp.studentId, resp.accountId);
                    result.postValue(Resource.success(new AuthResult(resp.accountId, resp.studentId, resp.role, resp.token)));
                } else {
                    result.postValue(Resource.error(errorMessage(response), null));
                }
            }

            @Override
            public void onFailure(Call<AuthDtos.AuthResponse> call, Throwable t) {
                result.postValue(Resource.error(networkErrorMessage(t), null));
            }
        });
        return result;
    }

    // ---- Reads ----------------------------------------------------------

    @Override
    public LiveData<Resource<List<Student>>> getStudents(String search, String programCode, String groupCode,
                                                           int page, int pageSize) {
        MutableLiveData<Resource<List<Student>>> result = new MutableLiveData<>(Resource.loading(null));
        api.listStudents(search, programCode, groupCode, page, pageSize).enqueue(new Callback<StudentsPageDto>() {
            @Override
            public void onResponse(Call<StudentsPageDto> call, Response<StudentsPageDto> response) {
                if (response.isSuccessful() && response.body() != null) {
                    List<Student> students = new ArrayList<>();
                    for (StudentDto dto : response.body().students) students.add(toDomain(dto));
                    result.postValue(Resource.success(students));
                } else {
                    result.postValue(Resource.error(errorMessage(response), null));
                }
            }

            @Override
            public void onFailure(Call<StudentsPageDto> call, Throwable t) {
                result.postValue(Resource.error(networkErrorMessage(t), null));
            }
        });
        return result;
    }

    @Override
    public LiveData<Resource<Student>> getMyProfile() {
        MutableLiveData<Resource<Student>> result = new MutableLiveData<>(Resource.loading(null));
        api.getMyProfile().enqueue(new Callback<StudentDto>() {
            @Override
            public void onResponse(Call<StudentDto> call, Response<StudentDto> response) {
                if (response.isSuccessful() && response.body() != null) {
                    result.postValue(Resource.success(toDomain(response.body())));
                } else {
                    result.postValue(Resource.error(errorMessage(response), null));
                }
            }

            @Override
            public void onFailure(Call<StudentDto> call, Throwable t) {
                result.postValue(Resource.error(networkErrorMessage(t), null));
            }
        });
        return result;
    }

    @Override
    public LiveData<Resource<Student>> getStudentById(String studentId) {
        MutableLiveData<Resource<Student>> result = new MutableLiveData<>(Resource.loading(null));
        api.getStudent(studentId).enqueue(new Callback<StudentDto>() {
            @Override
            public void onResponse(Call<StudentDto> call, Response<StudentDto> response) {
                if (response.isSuccessful() && response.body() != null) {
                    result.postValue(Resource.success(toDomain(response.body())));
                } else {
                    result.postValue(Resource.error(errorMessage(response), null));
                }
            }

            @Override
            public void onFailure(Call<StudentDto> call, Throwable t) {
                result.postValue(Resource.error(networkErrorMessage(t), null));
            }
        });
        return result;
    }

    @Override
    public LiveData<Resource<List<GroupInfo>>> getGroups() {
        MutableLiveData<Resource<List<GroupInfo>>> result = new MutableLiveData<>(Resource.loading(null));
        api.listGroups().enqueue(new Callback<GroupDtos.GroupsResponse>() {
            @Override
            public void onResponse(Call<GroupDtos.GroupsResponse> call, Response<GroupDtos.GroupsResponse> response) {
                if (response.isSuccessful() && response.body() != null) {
                    List<GroupInfo> groups = new ArrayList<>();
                    for (GroupDtos.GroupDto dto : response.body().groups) groups.add(toDomain(dto));
                    result.postValue(Resource.success(groups));
                } else {
                    result.postValue(Resource.error(errorMessage(response), null));
                }
            }

            @Override
            public void onFailure(Call<GroupDtos.GroupsResponse> call, Throwable t) {
                result.postValue(Resource.error(networkErrorMessage(t), null));
            }
        });
        return result;
    }

    // ---- Writes -----------------------------------------------------------

    @Override
    public LiveData<Resource<String>> createStudent(String operationId, String studentName, String studentNumber,
                                                      String programCode, String groupCode) {
        MutableLiveData<Resource<String>> result = new MutableLiveData<>(Resource.loading(null));
        StudentMutationDtos.CreateStudentRequest body =
                new StudentMutationDtos.CreateStudentRequest(studentName, studentNumber, programCode, groupCode);
        api.createStudent(operationId, body).enqueue(new Callback<StudentMutationDtos.CreateStudentResponse>() {
            @Override
            public void onResponse(Call<StudentMutationDtos.CreateStudentResponse> call,
                                    Response<StudentMutationDtos.CreateStudentResponse> response) {
                if (response.isSuccessful() && response.body() != null) {
                    // claim_code is also in response.body() — surface it to the lecturer's UI
                    // so they can hand it to the real student; not carried further here.
                    result.postValue(Resource.success(response.body().studentId));
                } else {
                    result.postValue(Resource.error(errorMessage(response), null));
                }
            }

            @Override
            public void onFailure(Call<StudentMutationDtos.CreateStudentResponse> call, Throwable t) {
                result.postValue(Resource.error(networkErrorMessage(t), null));
            }
        });
        return result;
    }

    @Override
    public LiveData<Resource<Student>> updateStudent(String studentId, String operationId, String studentName,
                                                       String programCode, Integer expectedVersion) {
        MutableLiveData<Resource<Student>> result = new MutableLiveData<>(Resource.loading(null));
        StudentMutationDtos.UpdateStudentRequest body =
                new StudentMutationDtos.UpdateStudentRequest(studentName, programCode, expectedVersion);
        api.updateStudent(studentId, operationId, body).enqueue(new Callback<StudentDto>() {
            @Override
            public void onResponse(Call<StudentDto> call, Response<StudentDto> response) {
                if (response.isSuccessful() && response.body() != null) {
                    result.postValue(Resource.success(toDomain(response.body())));
                } else {
                    // A 409 here (VERSION_CONFLICT or STUDENT_DELETED) means the caller should
                    // re-fetch the record and show the server's current version rather than retry blindly.
                    result.postValue(Resource.error(errorMessage(response), null));
                }
            }

            @Override
            public void onFailure(Call<StudentDto> call, Throwable t) {
                result.postValue(Resource.error(networkErrorMessage(t), null));
            }
        });
        return result;
    }

    @Override
    public LiveData<Resource<Student>> transferGroup(String studentId, String operationId, String groupCode,
                                                       Integer expectedVersion) {
        MutableLiveData<Resource<Student>> result = new MutableLiveData<>(Resource.loading(null));
        StudentMutationDtos.GroupTransferRequest body =
                new StudentMutationDtos.GroupTransferRequest(groupCode, expectedVersion);
        api.transferGroup(studentId, operationId, body).enqueue(new Callback<StudentMutationDtos.GroupTransferResponse>() {
            @Override
            public void onResponse(Call<StudentMutationDtos.GroupTransferResponse> call,
                                    Response<StudentMutationDtos.GroupTransferResponse> response) {
                if (response.isSuccessful() && response.body() != null) {
                    StudentMutationDtos.GroupTransferResponse body = response.body();
                    // The transfer endpoint doesn't echo the full student record, only the
                    // fields that changed — re-fetch if the caller needs everything else too.
                    result.postValue(Resource.success(new Student(body.studentId, null, null, "active",
                            body.version, null, body.groupCode)));
                } else {
                    // A 409 GROUP_FULL here means the previous group was retained — surface that
                    // to the user rather than silently leaving them in an unknown state.
                    result.postValue(Resource.error(errorMessage(response), null));
                }
            }

            @Override
            public void onFailure(Call<StudentMutationDtos.GroupTransferResponse> call, Throwable t) {
                result.postValue(Resource.error(networkErrorMessage(t), null));
            }
        });
        return result;
    }

    @Override
    public LiveData<Resource<Void>> deleteStudent(String studentId, String operationId) {
        MutableLiveData<Resource<Void>> result = new MutableLiveData<>(Resource.loading(null));
        api.deleteStudent(studentId, operationId).enqueue(new Callback<StudentDto>() {
            @Override
            public void onResponse(Call<StudentDto> call, Response<StudentDto> response) {
                if (response.isSuccessful()) {
                    result.postValue(Resource.success(null));
                } else {
                    result.postValue(Resource.error(errorMessage(response), null));
                }
            }

            @Override
            public void onFailure(Call<StudentDto> call, Throwable t) {
                result.postValue(Resource.error(networkErrorMessage(t), null));
            }
        });
        return result;
    }

    @Override
    public LiveData<Resource<Void>> requestNumberCorrection(String studentId, String requestedNumber) {
        MutableLiveData<Resource<Void>> result = new MutableLiveData<>(Resource.loading(null));
        api.requestCorrection(studentId, new StudentMutationDtos.CorrectionRequestBody(requestedNumber))
                .enqueue(new Callback<Void>() {
                    @Override
                    public void onResponse(Call<Void> call, Response<Void> response) {
                        if (response.isSuccessful()) {
                            result.postValue(Resource.success(null));
                        } else {
                            result.postValue(Resource.error(errorMessage(response), null));
                        }
                    }

                    @Override
                    public void onFailure(Call<Void> call, Throwable t) {
                        result.postValue(Resource.error(networkErrorMessage(t), null));
                    }
                });
        return result;
    }

    private static String networkErrorMessage(Throwable t) {
        if (t instanceof IOException) {
            return "Can't reach the server — check your connection and try again.";
        }
        return "Unexpected error: " + t.getMessage();
    }
}
