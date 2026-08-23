import java.io.File
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction

open class BuildTask : DefaultTask() {
    @Input
    var rootDirRel: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        // Hand-edited from the generated `npm` + extension-fallback dance:
        // on Windows with nvm4w, Gradle's process launcher failed to spawn
        // every one of npm/.exe/.cmd/.bat (cmd-script shims and Java's
        // hardened ProcessBuilder do not mix). `node` is a real executable
        // and spawns cleanly everywhere, so the tauri CLI is invoked through
        // its JS entry directly. Re-running `tauri android init` will
        // regenerate this file and undo the fix — re-apply it if the build
        // dies with "A problem occurred starting process 'command npm'".
        runTauriCli("node")
    }

    fun runTauriCli(executable: String) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val args = listOf("../node_modules/@tauri-apps/cli/tauri.js", "android", "android-studio-script");

        project.exec {
            workingDir(File(project.projectDir, rootDirRel))
            executable(executable)
            args(args)
            if (project.logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (project.logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
            if (release) {
                args("--release")
            }
            args(listOf("--target", target))
        }.assertNormalExitValue()
    }
}