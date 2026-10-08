package com.example.ict361_lab.ui;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;

import androidx.annotation.NonNull;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;
import androidx.navigation.fragment.NavHostFragment;

import com.example.ict361_lab.R;
import com.example.ict361_lab.databinding.FragmentFirstBinding;
import com.example.ict361_lab.model.GroupInfo;
import com.example.ict361_lab.repository.Resource;
import com.example.ict361_lab.viewmodel.StudentViewModel;
import com.example.ict361_lab.viewmodel.StudentViewModelFactory;

import java.util.List;

public class FirstFragment extends Fragment {

    private FragmentFirstBinding binding;
    private StudentViewModel viewModel;

    @Override
    public View onCreateView(
            @NonNull LayoutInflater inflater, ViewGroup container,
            Bundle savedInstanceState
    ) {

        binding = FragmentFirstBinding.inflate(inflater, container, false);
        return binding.getRoot();

    }

    public void onViewCreated(@NonNull View view, Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        // forRemote() talks to the real backend over ApiClient.BASE_URL (see network/ApiClient.java).
        // Swap to StudentViewModelFactory.with(new FakeStudentRepository()) to work on this
        // screen with no backend running.
        viewModel = new ViewModelProvider(this, StudentViewModelFactory.forRemote(requireContext()))
                .get(StudentViewModel.class);

        binding.buttonFirst.setOnClickListener(v ->
                NavHostFragment.findNavController(FirstFragment.this)
                        .navigate(R.id.action_FirstFragment_to_SecondFragment)
        );

        // TEMPORARY scaffolding — see the comment on this button in fragment_first.xml.
        // GET /api/groups requires no auth, so this is a public route: it proves the app can
        // reach the Node server and parse a real response without needing a login screen yet.
        binding.buttonCheckBackend.setOnClickListener(v -> {
            binding.textviewFirst.setText(R.string.checking_backend);
            viewModel.getGroups().observe(getViewLifecycleOwner(), this::renderGroupsResult);
        });
    }

    private void renderGroupsResult(Resource<List<GroupInfo>> resource) {
        switch (resource.status) {
            case LOADING:
                binding.textviewFirst.setText(R.string.checking_backend);
                break;
            case SUCCESS:
                StringBuilder sb = new StringBuilder("Connected. Groups:\n");
                if (resource.data != null) {
                    for (GroupInfo g : resource.data) {
                        sb.append(g.getGroupCode()).append(": ")
                                .append(g.getActiveCount()).append("/").append(g.getCapacity())
                                .append("\n");
                    }
                }
                binding.textviewFirst.setText(sb.toString());
                break;
            case ERROR:
                binding.textviewFirst.setText(getString(R.string.backend_connection_failed, resource.message));
                break;
        }
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        binding = null;
    }

}