package io.github.raja2102598.gymlog;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins, for background sync, Continue with Google and voice logging; plugins from npm register
        // themselves.
        registerPlugin(GymSyncPlugin.class);
        registerPlugin(GoogleSignInPlugin.class);
        registerPlugin(SpeechPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
