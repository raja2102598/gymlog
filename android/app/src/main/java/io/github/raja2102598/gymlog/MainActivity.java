package io.github.raja2102598.gymlog;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin, for background sync (see GymSyncPlugin); plugins from npm register themselves.
        registerPlugin(GymSyncPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
