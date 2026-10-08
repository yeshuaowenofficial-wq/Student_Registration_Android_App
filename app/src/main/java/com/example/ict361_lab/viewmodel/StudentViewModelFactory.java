package com.example.ict361_lab.viewmodel;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.lifecycle.ViewModel;
import androidx.lifecycle.ViewModelProvider;

import com.example.ict361_lab.network.ApiClient;
import com.example.ict361_lab.repository.RemoteStudentRepository;
import com.example.ict361_lab.repository.StudentRepository;

/**
 * StudentViewModel takes a StudentRepository in its constructor, so it
 * needs a factory rather than the no-arg default. Usage from a Fragment:
 *
 *   StudentViewModel vm = new ViewModelProvider(this,
 *       StudentViewModelFactory.forRemote(requireContext()))
 *       .get(StudentViewModel.class);
 *
 * Swap in StudentViewModelFactory.with(new FakeStudentRepository()) to
 * develop a screen without a running backend, and swap in whatever
 * offline-first repository the sync team builds once it exists — the
 * Fragment code doesn't need to change either time, only this line.
 */
public class StudentViewModelFactory implements ViewModelProvider.Factory {

    private final StudentRepository repository;

    private StudentViewModelFactory(StudentRepository repository) {
        this.repository = repository;
    }

    public static StudentViewModelFactory with(StudentRepository repository) {
        return new StudentViewModelFactory(repository);
    }

    public static StudentViewModelFactory forRemote(Context context) {
        RemoteStudentRepository repo = new RemoteStudentRepository(
                ApiClient.get(context), ApiClient.getTokenStore(context));
        return new StudentViewModelFactory(repo);
    }

    @NonNull
    @Override
    @SuppressWarnings("unchecked")
    public <T extends ViewModel> T create(@NonNull Class<T> modelClass) {
        if (modelClass.isAssignableFrom(StudentViewModel.class)) {
            return (T) new StudentViewModel(repository);
        }
        throw new IllegalArgumentException("Unknown ViewModel class: " + modelClass);
    }
}
